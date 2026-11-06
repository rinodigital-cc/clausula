import "server-only";
import { withPlatform } from "@/lib/db/client";
import { hashToken, newToken } from "@/lib/auth/password";
import { appUrl, enqueueEmail, invitationEmail } from "@/lib/email/outbox";
import { ROLE_LABEL } from "@/lib/authz/policy";
import type { CurrentUser } from "@/lib/auth/web";

/**
 * Operações do operador da plataforma (administrador da ApoIA Seguro).
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
): Promise<{ orgId: string; inviteLink: string }> {
  assertPlatform(actor);
  const name = input.name.trim();
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const base = slugify(name);
  if (base.length < 2) throw new Error("Nome da corretora muito curto.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new Error("E-mail do responsável inválido.");
  const insurers = [...new Set(input.insurers.map((s) => s.trim()).filter((s) => s.length >= 2))].slice(0, 30);

  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 864e5);

  const orgId = await withPlatform("criação de corretora", (db) =>
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
      await tx`
        INSERT INTO invitations (org_id, email, role, token_hash, invited_by, expires_at)
        VALUES (${id}, ${ownerEmail}, 'owner', ${hashToken(token)}, ${actor.userId}, ${expiresAt})
      `;
      await tx`
        INSERT INTO audit_logs (org_id, actor_id, action, entity_type, entity_id, metadata)
        VALUES (${id}, ${actor.userId}, 'organization.created', 'organization', ${id},
                ${JSON.stringify({ by: "platform", implementer: input.joinAsImplementer, insurers: insurers.length })}::text::jsonb)
      `;
      await enqueueEmail(
        tx as never,
        invitationEmail({
          orgId: id,
          to: ownerEmail,
          orgName: name,
          inviterName: "A equipe ApoIA Seguro",
          roleLabel: ROLE_LABEL.owner,
          link: appUrl(`/convite/${token}`),
          expiresDays: INVITE_TTL_DAYS,
        }),
      );
      return id;
    }),
  );

  return { orgId, inviteLink: appUrl(`/convite/${token}`) };
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
};

export async function listBrokerages(actor: CurrentUser): Promise<BrokerageRow[]> {
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
        (SELECT i.email::text FROM invitations i WHERE i.org_id = o.id AND i.role = 'owner'
           AND i.accepted_at IS NULL ORDER BY i.created_at DESC LIMIT 1) AS "ownerPending"
      FROM organizations o
      WHERE o.deleted_at IS NULL
      ORDER BY o.created_at DESC
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

/** Reemite o convite de proprietário (o anterior deixa de valer). */
export async function reissueOwnerInvite(actor: CurrentUser, orgId: string, email: string): Promise<string> {
  assertPlatform(actor);
  const to = email.trim().toLowerCase();
  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 864e5);
  await withPlatform("reemissão de convite de proprietário", (db) =>
    db.begin(async (tx) => {
      const [org] = await tx<{ name: string }[]>`SELECT name FROM organizations WHERE id = ${orgId}`;
      if (!org) throw new Error("Corretora não encontrada.");
      const [owner] = await tx`SELECT 1 FROM memberships WHERE org_id = ${orgId} AND role = 'owner' AND status = 'active'`;
      if (owner) throw new Error("A corretora já tem proprietário ativo.");
      await tx`
        UPDATE invitations SET expires_at = now()
        WHERE org_id = ${orgId} AND role = 'owner' AND accepted_at IS NULL
      `;
      await tx`
        INSERT INTO invitations (org_id, email, role, token_hash, invited_by, expires_at)
        VALUES (${orgId}, ${to}, 'owner', ${hashToken(token)}, ${actor.userId}, ${expiresAt})
        ON CONFLICT (org_id, email) WHERE accepted_at IS NULL
        DO UPDATE SET token_hash = EXCLUDED.token_hash, role = 'owner', expires_at = EXCLUDED.expires_at
      `;
      await enqueueEmail(
        tx as never,
        invitationEmail({
          orgId,
          to,
          orgName: org.name,
          inviterName: "A equipe ApoIA Seguro",
          roleLabel: ROLE_LABEL.owner,
          link: appUrl(`/convite/${token}`),
          expiresDays: INVITE_TTL_DAYS,
        }),
      );
    }),
  );
  return appUrl(`/convite/${token}`);
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
