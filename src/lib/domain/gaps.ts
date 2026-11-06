import "server-only";
import { withTenant, isUuid } from "@/lib/db/client";
import type { Session } from "@/lib/auth/session";
import { authorize } from "@/lib/authz/policy";
import { recordAudit } from "@/lib/audit";
import { dividirNota } from "@services/ai/nucleo";
import { defaultSpecialistId } from "@/lib/domain/documents";
import { appUrl, enqueueEmail, gapResolvedEmail } from "@/lib/email/outbox";

/**
 * Lacunas: perguntas que a biblioteca não respondeu. Resolver uma lacuna
 * cria uma fonte de CONHECIMENTO INTERNO, citável, e avisa quem perguntou.
 */
export type GapRow = {
  id: string;
  question: string;
  askCount: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  askedBy: string | null;
  resolutionNote: string | null;
};

export async function listGaps(session: Session, status: "open" | "resolved" | "dismissed" = "open"): Promise<GapRow[]> {
  authorize(session, "gap.manage");
  return withTenant(session, (tx) =>
    tx<GapRow[]>`
      SELECT g.id, g.question, g.ask_count AS "askCount", g.status, g.created_at AS "createdAt", g.updated_at AS "updatedAt",
             u.name AS "askedBy", g.resolution_note AS "resolutionNote"
      FROM knowledge_gaps g LEFT JOIN users u ON u.id = g.first_asked_by
      WHERE g.status = ${status}
      ORDER BY g.ask_count DESC, g.updated_at DESC
      LIMIT 200
    `,
  );
}

const SECTION_MAP: Record<string, string> = {
  coverage: "coverage",
  exclusion: "exclusion",
  condition: "waiting_period",
  definition: "definition",
  procedure: "procedure",
  other: "general",
};

export async function resolveGap(
  session: Session,
  input: { gapId: string; title: string; answer: string; insurerId?: string | null },
): Promise<{ sourceId: string }> {
  authorize(session, "gap.manage");
  authorize(session, "note.write");
  if (!isUuid(input.gapId)) throw new Error("Pergunta inválida.");
  const answer = input.answer.trim();
  const title = input.title.trim().slice(0, 200);
  if (answer.length < 20) throw new Error("Escreva uma resposta com pelo menos 20 caracteres.");
  if (answer.length > 8000) throw new Error("Resposta longa demais (máximo de 8.000 caracteres).");
  if (title.length < 3) throw new Error("Dê um título curto ao conhecimento.");

  return withTenant(session, async (tx) => {
    const [gap] = await tx<{ id: string; question: string; first_asked_by: string | null; email: string | null }[]>`
      SELECT g.id, g.question, g.first_asked_by, u.email::text AS email
      FROM knowledge_gaps g LEFT JOIN users u ON u.id = g.first_asked_by
      WHERE g.id = ${input.gapId} AND g.status = 'open' FOR UPDATE OF g
    `;
    if (!gap) throw new Error("Pergunta não encontrada ou já respondida.");

    const specialistId = await defaultSpecialistId(tx);
    const [src] = await tx<{ id: string }[]>`
      INSERT INTO knowledge_sources (org_id, specialist_id, kind, title, origin, insurer_id, doc_type,
                                     rights_confirmed_by, rights_confirmed_at, created_by)
      VALUES ((SELECT current_org()), ${specialistId}, 'internal_note', ${title}, 'written', ${input.insurerId ?? null},
              'nota_interna', ${session.userId}, now(), ${session.userId})
      RETURNING id
    `;
    const [ver] = await tx<{ id: string }[]>`
      INSERT INTO source_versions (org_id, source_id, version_number, status, is_current, page_count, stage, processed_at, uploaded_by)
      VALUES ((SELECT current_org()), ${src!.id}, 1, 'processing', true, 1, 'Organizando', now(), ${session.userId})
      RETURNING id
    `;
    const parts = dividirNota(title, answer);
    let ordinal = 0;
    for (const p of parts) {
      ordinal++;
      await tx`
        INSERT INTO chunks (org_id, specialist_id, source_version_id, ordinal, clause_path, clause_title, section_kind,
                            page_start, page_end, content, heading_trail, suspicious)
        VALUES ((SELECT current_org()), ${specialistId}, ${ver!.id}, ${ordinal}, NULL, ${title},
                ${SECTION_MAP[p.section_kind] ?? "general"}, 1, 1, ${p.content}, ${p.heading_trail}, ${p.suspicious})
      `;
    }
    await tx`
      INSERT INTO document_pages (org_id, source_version_id, page_number, content)
      VALUES ((SELECT current_org()), ${ver!.id}, 1, ${title + "\n\n" + answer})
    `;
    await tx`UPDATE source_versions SET status = 'ready', stage = 'Pronto', chunk_count = ${ordinal} WHERE id = ${ver!.id}`;
    await tx`
      UPDATE knowledge_gaps SET status = 'resolved', resolution_note = ${title}, resolved_by = ${session.userId}, resolved_at = now()
      WHERE id = ${gap.id}
    `;
    if (gap.first_asked_by) {
      await tx`
        INSERT INTO notifications (org_id, user_id, kind, title, body, link_url)
        VALUES ((SELECT current_org()), ${gap.first_asked_by}, 'gap_resolved', 'Sua dúvida agora tem resposta',
                ${gap.question}, '/app')
      `;
      if (gap.email) {
        await enqueueEmail(tx, gapResolvedEmail({ orgId: session.orgId, to: gap.email, question: gap.question, link: appUrl("/app") }));
      }
    }
    await recordAudit(tx, { actorId: session.userId, action: "gap.resolved", entityType: "knowledge_gap", entityId: gap.id, metadata: { sourceId: src!.id } });
    await recordAudit(tx, { actorId: session.userId, action: "note.created", entityType: "knowledge_source", entityId: src!.id });
    return { sourceId: src!.id };
  });
}

export async function dismissGap(session: Session, gapId: string): Promise<void> {
  authorize(session, "gap.manage");
  await withTenant(session, async (tx) => {
    const r = await tx`UPDATE knowledge_gaps SET status = 'dismissed', resolved_by = ${session.userId}, resolved_at = now()
                       WHERE id = ${gapId} AND status = 'open'`;
    if (r.count === 0) throw new Error("Pergunta não encontrada.");
    await recordAudit(tx, { actorId: session.userId, action: "gap.dismissed", entityType: "knowledge_gap", entityId: gapId });
  });
}

/** Painel inicial da administração: só contagens reais. */
export async function adminOverview(session: Session) {
  authorize(session, "analytics.read");
  return withTenant(session, async (tx) => {
    const [r] = await tx<
      { ready: number; processing: number; failed: number; expired: number; members: number; invites: number; gaps: number;
        consults7: number; notFound7: number; negative: number }[]
    >`
      SELECT
        (SELECT count(*)::int FROM source_versions v JOIN knowledge_sources s ON s.id = v.source_id
           WHERE v.is_current AND s.status = 'active' AND v.status IN ('ready','ready_with_warnings')) AS ready,
        (SELECT count(*)::int FROM source_versions WHERE status IN ('queued','processing')) AS processing,
        (SELECT count(*)::int FROM source_versions WHERE status = 'failed') AS failed,
        (SELECT count(*)::int FROM source_versions v JOIN knowledge_sources s ON s.id = v.source_id
           WHERE v.is_current AND s.status = 'active' AND v.valid_until < current_date) AS expired,
        (SELECT count(*)::int FROM memberships WHERE status = 'active') AS members,
        (SELECT count(*)::int FROM invitations WHERE accepted_at IS NULL AND expires_at > now()) AS invites,
        (SELECT count(*)::int FROM knowledge_gaps WHERE status = 'open') AS gaps,
        (SELECT count(*)::int FROM messages WHERE created_at > now() - interval '7 days') AS consults7,
        (SELECT count(*)::int FROM messages WHERE created_at > now() - interval '7 days' AND confidence = 'not_found') AS "notFound7",
        (SELECT count(*)::int FROM feedback WHERE rating IN ('wrong','incomplete') AND created_at > now() - interval '30 days') AS negative
    `;
    return r!;
  });
}

export type FeedbackRow = { id: string; rating: string; comment: string | null; question: string; summary: string; userName: string; createdAt: Date; conversationId: string };

export async function listNegativeFeedback(session: Session): Promise<FeedbackRow[]> {
  authorize(session, "conversation.read.org");
  return withTenant(session, (tx) =>
    tx<FeedbackRow[]>`
      SELECT f.id, f.rating, f.comment, m.question, m.summary, u.name AS "userName", f.created_at AS "createdAt",
             m.conversation_id AS "conversationId"
      FROM feedback f JOIN messages m ON m.id = f.message_id JOIN users u ON u.id = f.user_id
      WHERE f.rating IN ('wrong','incomplete')
      ORDER BY f.created_at DESC LIMIT 100
    `,
  );
}
