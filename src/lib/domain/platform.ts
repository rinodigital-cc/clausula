import "server-only";
import { withPlatform } from "@/lib/db/client";
import { hashToken, newToken } from "@/lib/auth/password";
import { appUrl, brokerageInvitationEmail, enqueueEmail } from "@/lib/email/outbox";
import type { CurrentUser } from "@/lib/auth/web";

/**
 * Operações do operador da plataforma (administrador da Vera.ia).
 * Papel de banco `app_platform`: enxerga metadados de corretoras, nunca
 * documentos, trechos ou conversas.
 */

export const INVITE_TTL_DAYS = 7;

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function assertPlatform(actor: CurrentUser) {
  if (!actor.isPlatformAdmin) throw new Error("Apenas a administração da plataforma pode fazer isso.");
}

export type BrokerageInput = {
  name: string;
  document?: string;
  ownerEmail: string;
  ownerName?: string;
  insurers: string[];
  joinAsImplementer: boolean;
};

export async function createBrokerage(
  actor: CurrentUser,
  input: BrokerageInput,
): Promise<{ orgId: string; inviteLink: string; emailId: string }> {
  assertPlatform(actor);
  const name = input.name.trim();
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const base = slugify(name);
  if (base.length < 2) throw new Error("Nome da corretora muito curto.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new Error("E-mail do responsável inválido.");
  const insurers = [...new Set(input.insurers.map((s) => s.trim()).filter((s) => s.length >= 2))].slice(0, 30);

  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 864e5);

  // Duplicidade: mesmo responsável com convite pendente para corretora de mesmo nome.
  const [dup] = await withPlatform("verificação de duplicidade de corretora", (db) =>
    db<{ id: string }[]>`
      SELECT o.id FROM organizations o JOIN invitations i ON i.org_id = o.id
      WHERE o.deleted_at IS NULL AND lower(o.name) = lower(${name}) AND i.email = ${ownerEmail}
        AND i.role = 'owner' AND i.accepted_at IS NULL AND i.expires_at > now()
      LIMIT 1`);
  if (dup) throw new Error("Já existe esta corretora com convite pendente para este e-mail. Use “Reenviar convite”.");

  const { orgId, emailId } = await withPlatform("criação de corretora", (db) =>
    db.begin(async (tx) => {
      let slug = base;
      for (let i = 2; i <= 50; i++) {
        const [taken] = await tx`SELECT 1 FROM organizations WHERE slug = ${slug} AND deleted_at IS NULL`;
        if (!taken) break;
        slug = `${base}-${i}`;
      }
      const [org] = await tx<{ id: string }[]>`
        INSERT INTO organizations (name, slug, document, status)
        VALUES (${name}, ${slug}, ${input.document?.trim() || null}, 'trial')
        RETURNING id
      `;
      const id = org!.id;

      await tx`
        INSERT INTO specialists (org_id, name, branch, status, published_at, created_by)
        VALUES (${id}, 'Assistente da corretora', 'geral', 'published', now(), ${actor.userId})
      `;
      for (const ins of insurers) {
        await tx`INSERT INTO insurers (org_id, name) VALUES (${id}, ${ins}) ON CONFLICT DO NOTHING`;
      }
      if (input.joinAsImplementer) {
        await tx`
          INSERT INTO memberships (org_id, user_id, role, invited_by)
          VALUES (${id}, ${actor.userId}, 'admin', ${actor.userId})
        `;
      }
      const [invite] = await tx<{ id: string }[]>`
        INSERT INTO invitations (org_id, email, role, token_hash, invited_by, expires_at)
        VALUES (${id}, ${ownerEmail}, 'owner', ${hashToken(token)}, ${actor.userId}, ${expiresAt})
        RETURNING id
      `;
      await tx`
        INSERT INTO audit_logs (org_id, actor_id, action, entity_type, entity_id, metadata)
        VALUES (${id}, ${actor.userId}, 'organization.created', 'organization', ${id},
                ${JSON.stringify({ by: "platform", implementer: input.joinAsImplementer, insurers: insurers.length })}::text::jsonb)
      `;
      const emailId = await enqueueEmail(
        tx as never,
        brokerageInvitationEmail({
          orgId: id,
          to: ownerEmail,
          orgName: name,
          link: appUrl(`/convite/${token}`),
          expiresDays: INVITE_TTL_DAYS,
          invitationId: invite!.id,
        }),
      );
      return { orgId: id, emailId };
    }),
  );

  return { orgId, emailId, inviteLink: appUrl(`/convite/${token}`) };
}

export type BrokerageRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
  members: number;
  pendingInvites: number;
  docsReady: number;
  docsProcessing: number;
  docsFailed: number;
  ownerEmail: string | null;
  ownerPending: string | null;
  inviteExpiresAt: Date | null;
  emailStatus: string | null;
  deliveryStatus: string | null;
  emailError: string | null;
  emailSentAt: Date | null;
  emailCreatedAt: Date | null;
  emailProviderId: string | null;
  emailAttempts: number | null;
};

export { ACCESS_STATE_LABEL, accessState, type AccessState } from "./access-state";

export async function listBrokerages(actor: CurrentUser, onlyOrgId?: string): Promise<BrokerageRow[]> {
  assertPlatform(actor);
  return withPlatform("lista de corretoras", (db) =>
    db<BrokerageRow[]>`
      SELECT o.id, o.name, o.slug::text AS slug, o.status, o.created_at AS "createdAt",
        (SELECT count(*)::int FROM memberships m WHERE m.org_id = o.id AND m.status = 'active') AS members,
        (SELECT count(*)::int FROM invitations i WHERE i.org_id = o.id AND i.accepted_at IS NULL AND i.expires_at > now()) AS "pendingInvites",
        (SELECT count(*)::int FROM source_versions v WHERE v.org_id = o.id AND v.status IN ('ready','ready_with_warnings')) AS "docsReady",
        (SELECT count(*)::int FROM source_versions v WHERE v.org_id = o.id AND v.status IN ('queued','processing')) AS "docsProcessing",
        (SELECT count(*)::int FROM source_versions v WHERE v.org_id = o.id AND v.status = 'failed') AS "docsFailed",
        (SELECT u.email::text FROM memberships m JOIN users u ON u.id = m.user_id
           WHERE m.org_id = o.id AND m.role = 'owner' AND m.status = 'active' LIMIT 1) AS "ownerEmail",
        inv.email AS "ownerPending", inv.expires_at AS "inviteExpiresAt",
        em.status AS "emailStatus", em.delivery_status AS "deliveryStatus", em.last_error AS "emailError",
        em.sent_at AS "emailSentAt", em.created_at AS "emailCreatedAt", em.provider_message_id AS "emailProviderId",
        em.attempts AS "emailAttempts"
      FROM organizations o
      LEFT JOIN LATERAL (
        SELECT i.id, i.email::text AS email, i.expires_at FROM invitations i
        WHERE i.org_id = o.id AND i.role = 'owner' AND i.accepted_at IS NULL
        ORDER BY i.updated_at DESC, i.created_at DESC LIMIT 1
      ) inv ON true
      LEFT JOIN LATERAL (
        SELECT e.status, e.delivery_status, e.last_error, e.sent_at, e.created_at, e.provider_message_id, e.attempts
        FROM email_outbox e
        WHERE e.org_id = o.id AND e.kind IN ('brokerage_invitation','invitation_resend','invitation')
          AND (inv.id IS NULL OR e.invitation_id = inv.id OR e.invitation_id IS NULL)
        ORDER BY e.created_at DESC LIMIT 1
      ) em ON true
      WHERE o.deleted_at IS NULL AND (${onlyOrgId ?? null}::uuid IS NULL OR o.id = ${onlyOrgId ?? null}::uuid)
      ORDER BY o.created_at DESC
      LIMIT 500
    `,
  );
}

export async function setBrokerageStatus(actor: CurrentUser, orgId: string, status: string): Promise<void> {
  assertPlatform(actor);
  if (!["trial", "active", "suspended"].includes(status)) throw new Error("Situação inválida.");
  await withPlatform("alteração de situação de corretora", (db) =>
    db.begin(async (tx) => {
      await tx`UPDATE organizations SET status = ${status} WHERE id = ${orgId} AND deleted_at IS NULL`;
      await tx`
        INSERT INTO audit_logs (org_id, actor_id, action, entity_type, entity_id, metadata)
        VALUES (${orgId}, ${actor.userId}, 'organization.updated', 'organization', ${orgId},
                ${JSON.stringify({ status, by: "platform" })}::text::jsonb)
      `;
    }),
  );
}

/** Intervalo mínimo entre reenvios e teto diário por corretora (protege a franquia gratuita). */
export const REISSUE_COOLDOWN_SECONDS = Math.max(0, Number(process.env.EMAIL_REISSUE_COOLDOWN_SECONDS ?? 120) || 0);
export const REISSUE_DAILY_LIMIT = 5;

/** Reemite o convite de proprietário (o anterior deixa de valer). */
export async function reissueOwnerInvite(actor: CurrentUser, orgId: string, email: string): Promise<{ link: string; emailId: string }> {
  assertPlatform(actor);
  const to = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("E-mail do responsável inválido.");
  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 864e5);
  const emailId = await withPlatform("reemissão de convite de proprietário", (db) =>
    db.begin(async (tx) => {
      const [recent] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM email_outbox
        WHERE org_id = ${orgId} AND kind IN ('brokerage_invitation','invitation_resend','invitation')
          AND created_at > now() - make_interval(secs => ${REISSUE_COOLDOWN_SECONDS})`;
      if ((recent?.n ?? 0) > 0) throw new Error("Um convite acabou de ser enviado. Aguarde 2 minutos antes de reenviar.");
      const [ok] = await tx<{ ok: boolean }[]>`SELECT consume_email_limit(${`reissue:${orgId}`}, ${REISSUE_DAILY_LIMIT}, interval '1 day') AS ok`;
      if (!ok?.ok) throw new Error(`Limite de ${REISSUE_DAILY_LIMIT} reenvios por dia para esta corretora atingido.`);
      const [org] = await tx<{ name: string }[]>`SELECT name FROM organizations WHERE id = ${orgId}`;
      if (!org) throw new Error("Corretora não encontrada.");
      const [owner] = await tx`SELECT 1 FROM memberships WHERE org_id = ${orgId} AND role = 'owner' AND status = 'active'`;
      if (owner) throw new Error("A corretora já tem proprietário ativo.");
      await tx`
        UPDATE invitations SET expires_at = now()
        WHERE org_id = ${orgId} AND role = 'owner' AND accepted_at IS NULL
      `;
      const [invite] = await tx<{ id: string }[]>`
        INSERT INTO invitations (org_id, email, role, token_hash, invited_by, expires_at)
        VALUES (${orgId}, ${to}, 'owner', ${hashToken(token)}, ${actor.userId}, ${expiresAt})
        ON CONFLICT (org_id, email) WHERE accepted_at IS NULL
        DO UPDATE SET token_hash = EXCLUDED.token_hash, role = 'owner', expires_at = EXCLUDED.expires_at
        RETURNING id
      `;
      await tx`
        INSERT INTO audit_logs (org_id, actor_id, action, entity_type, entity_id, metadata)
        VALUES (${orgId}, ${actor.userId}, 'invitation.reissued', 'invitation', ${invite!.id},
                ${JSON.stringify({ by: "platform" })}::text::jsonb)
      `;
      return enqueueEmail(
        tx as never,
        brokerageInvitationEmail({
          orgId,
          to,
          orgName: org.name,
          link: appUrl(`/convite/${token}`),
          expiresDays: INVITE_TTL_DAYS,
          resend: true,
          invitationId: invite!.id,
        }),
      );
    }),
  );
  return { link: appUrl(`/convite/${token}`), emailId };
}

export type LeadRow = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
  teamSize: string | null;
  interest: string;
  message: string | null;
  status: string;
  createdAt: Date;
};

export async function listLeads(actor: CurrentUser): Promise<LeadRow[]> {
  assertPlatform(actor);
  return withPlatform("lista de interessados", (db) =>
    db<LeadRow[]>`
      SELECT id, name, email::text AS email, company, phone, team_size AS "teamSize", interest, message, status,
             created_at AS "createdAt"
      FROM leads ORDER BY created_at DESC LIMIT 200
    `,
  );
}

export async function setLeadStatus(actor: CurrentUser, leadId: string, status: string): Promise<void> {
  assertPlatform(actor);
  if (!["new", "contacted", "qualified", "discarded"].includes(status)) throw new Error("Situação inválida.");
  await withPlatform("situação de interessado", (db) => db`UPDATE leads SET status = ${status} WHERE id = ${leadId}`);
}

/** Uma corretora (página de detalhe) sem carregar a lista inteira. */
export async function getBrokerage(actor: CurrentUser, orgId: string): Promise<BrokerageRow | null> {
  return (await listBrokerages(actor, orgId))[0] ?? null;
}

export type EmailHistoryRow = {
  id: string;
  kind: string;
  to: string;
  status: string;
  deliveryStatus: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  providerId: string | null;
  events: { type: string; at: string }[];
};

/** Histórico de tentativas de envio de uma corretora (metadados; nunca corpo ou link). */
export async function brokerageEmailHistory(actor: CurrentUser, orgId: string): Promise<EmailHistoryRow[]> {
  assertPlatform(actor);
  return withPlatform("histórico de envios da corretora", (db) =>
    db<EmailHistoryRow[]>`
      SELECT e.id, e.kind, e.to_email::text AS "to", e.status, e.delivery_status AS "deliveryStatus", e.attempts,
             e.last_error AS "lastError", e.created_at AS "createdAt", e.sent_at AS "sentAt",
             e.delivered_at AS "deliveredAt", e.provider_message_id AS "providerId",
             coalesce((SELECT json_agg(json_build_object('type', ev.type, 'at', ev.received_at) ORDER BY ev.received_at)
                       FROM email_events ev WHERE ev.outbox_id = e.id), '[]'::json) AS events
      FROM email_outbox e
      WHERE e.org_id = ${orgId}
      ORDER BY e.created_at DESC LIMIT 30`,
  );
}
