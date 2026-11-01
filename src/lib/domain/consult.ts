import "server-only";
import { withTenant, isUuid } from "@/lib/db/client";
import type { Session } from "@/lib/auth/session";
import { authorize } from "@/lib/authz/policy";
import { retrieve } from "@services/ai/retrieval";
import { answerQuestion, type AnswerResult, type Warning } from "@services/ai/answer";
import { normalizar } from "@services/ai/nucleo";
import { defaultSpecialistId } from "@/lib/domain/documents";

/**
 * Consulta: pergunta → recuperação (só da corretora) → resposta ancorada →
 * validação → persistência (mensagem + retrato das citações) → lacuna se
 * não encontrou.
 */
const PER_USER_HOUR = Number(process.env.RATE_LIMIT_USER_HOUR ?? 60);
const PER_ORG_HOUR = Number(process.env.RATE_LIMIT_ORG_HOUR ?? 600);
const DAILY_BUDGET_BRL = Number(process.env.DAILY_BUDGET_BRL ?? 0);

export class ConsultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsultError";
  }
}

export type AskInput = {
  question: string;
  conversationId?: string | null;
  insurerId?: string | null;
  productId?: string | null;
};

export type AskResult = { conversationId: string; messageId: string; result: AnswerResult };

export async function ask(session: Session, input: AskInput): Promise<AskResult> {
  authorize(session, "specialist.query");
  const question = (input.question ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
  if (question.length < 3) throw new ConsultError("Escreva a pergunta com pelo menos 3 caracteres.");
  for (const id of [input.conversationId, input.insurerId, input.productId]) {
    if (id && !isUuid(id)) throw new ConsultError("Parâmetro inválido.");
  }
  const started = Date.now();

  // Fase 1: limites, orçamento e recuperação (transação curta; nada de rede aqui dentro)
  const prep = await withTenant(session, async (tx) => {
    const [u] = await tx<{ ok: boolean }[]>`
      SELECT consume_rate_limit(${"consulta:" + session.userId}, ${PER_USER_HOUR}, interval '1 hour') AS ok`;
    if (!u?.ok) throw new ConsultError("Muitas perguntas em pouco tempo. Espere alguns minutos e tente de novo.");
    const [o] = await tx<{ ok: boolean }[]>`SELECT consume_rate_limit('consulta:org', ${PER_ORG_HOUR}, interval '1 hour') AS ok`;
    if (!o?.ok) throw new ConsultError("A corretora atingiu o limite de consultas desta hora. Tente em alguns minutos.");

    let budget: "normal" | "economy" | "exhausted" = "normal";
    if (DAILY_BUDGET_BRL > 0) {
      const [spent] = await tx<{ total: string }[]>`
        SELECT coalesce(sum(cost_brl), 0)::text AS total FROM usage_events
        WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
      `;
      const total = Number(spent?.total ?? 0);
      if (total >= DAILY_BUDGET_BRL) budget = "exhausted";
      else if (total >= DAILY_BUDGET_BRL * 0.7) budget = "economy";
    }

    if (input.conversationId) {
      const [c] = await tx`SELECT 1 FROM conversations WHERE id = ${input.conversationId} AND user_id = ${session.userId}`;
      if (!c) throw new ConsultError("Conversa não encontrada.");
    }
    const r = await retrieve(tx, question, { insurerId: input.insurerId, productId: input.productId });
    const [org] = await tx<{ instructions: string | null }[]>`
      SELECT config->>'instructions' AS instructions FROM specialists WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`;
    return { ...r, budget, instructions: org?.instructions ?? "" };
  });

  // Fase 2: geração fora de transação (chamada de rede pode levar segundos)
  const result = await answerQuestion({
    question,
    terms: prep.presentTerms.length ? prep.presentTerms : prep.terms,
    allTerms: prep.terms,
    chunks: prep.chunks,
    insurerFiltered: !!input.insurerId,
    orgInstructions: prep.instructions,
    budget: prep.budget,
  });

  // Fase 3: persistência
  const latency = Date.now() - started;
  return withTenant(session, async (tx) => {
    let conversationId = input.conversationId ?? null;
    if (!conversationId) {
      const specialistId = await defaultSpecialistId(tx);
      const [c] = await tx<{ id: string }[]>`
        INSERT INTO conversations (org_id, user_id, specialist_id, title)
        VALUES ((SELECT current_org()), ${session.userId}, ${specialistId}, ${question.slice(0, 140)})
        RETURNING id
      `;
      conversationId = c!.id;
    } else {
      await tx`UPDATE conversations SET updated_at = now() WHERE id = ${conversationId}`;
    }

    const answerJson = {
      claims: result.claims,
      suggestedRephrase: result.suggestedRephrase ?? null,
      retrieved: prep.chunks.length,
    };
    const [m] = await tx<{ id: string }[]>`
      INSERT INTO messages (org_id, conversation_id, user_id, question, status, confidence, summary, answer, warnings,
                            mode, model, latency_ms)
      VALUES ((SELECT current_org()), ${conversationId}, ${session.userId}, ${question}, ${result.status},
              ${result.confidence}, ${result.summary}, ${JSON.stringify(answerJson)}::text::jsonb,
              ${JSON.stringify(result.warnings)}::text::jsonb, ${result.mode}, ${result.model}, ${latency})
      RETURNING id
    `;
    const messageId = m!.id;

    let ordinal = 0;
    for (const c of result.cited) {
      ordinal++;
      const quote = result.claims.find((k) => k.chunk_id === c.chunk_id)?.quote ?? c.content.slice(0, 300);
      await tx`
        INSERT INTO message_citations (org_id, message_id, ordinal, chunk_id, source_version_id, source_title,
                                       insurer_name, product_name, version_number, clause_path, clause_title,
                                       page_number, section_kind, quote)
        VALUES ((SELECT current_org()), ${messageId}, ${ordinal}, ${c.chunk_id}, ${c.source_version_id}, ${c.source_title},
                ${c.insurer_name}, ${c.product_name}, ${c.version_number}, ${c.clause_path}, ${c.clause_title},
                ${c.page_number}, ${c.section_kind}, ${quote})
      `;
    }

    await tx`
      INSERT INTO usage_events (org_id, user_id, kind, tokens_in, tokens_out, cost_brl)
      VALUES ((SELECT current_org()), ${session.userId}, ${"consulta_" + result.mode}, ${result.tokensIn}, ${result.tokensOut}, ${result.costBrl})
    `;

    // Não encontrou → vira lacuna para a administração (ciclo do conhecimento interno)
    if (result.confidence === "not_found") {
      const normalized = normalizar(question).slice(0, 300);
      await tx`
        INSERT INTO knowledge_gaps (org_id, question, normalized, first_asked_by)
        VALUES ((SELECT current_org()), ${question}, ${normalized}, ${session.userId})
        ON CONFLICT (org_id, normalized) WHERE status = 'open'
        DO UPDATE SET ask_count = knowledge_gaps.ask_count + 1, updated_at = now()
      `;
    }
    return { conversationId: conversationId!, messageId, result };
  });
}

export type Citation = {
  ordinal: number;
  chunkId: string | null;
  sourceVersionId: string | null;
  sourceTitle: string;
  insurerName: string | null;
  productName: string | null;
  versionNumber: number | null;
  clausePath: string | null;
  clauseTitle: string | null;
  pageNumber: number | null;
  sectionKind: string | null;
  quote: string;
};

export type MessageView = {
  id: string;
  question: string;
  status: string;
  confidence: "strong" | "partial" | "not_found";
  summary: string;
  claims: { kind: string; text: string; quote: string; citation: number }[];
  warnings: Warning[];
  mode: "generative" | "extractive";
  createdAt: Date;
  citations: Citation[];
  myFeedback: string | null;
  suggestedRephrase: string | null;
};

export async function getConversation(session: Session, conversationId: string) {
  authorize(session, "conversation.read.own");
  if (!isUuid(conversationId)) return null;
  return withTenant(session, async (tx) => {
    const [conv] = await tx<{ id: string; title: string; userId: string; createdAt: Date; authorName: string }[]>`
      SELECT c.id, c.title, c.user_id AS "userId", c.created_at AS "createdAt", u.name AS "authorName"
      FROM conversations c JOIN users u ON u.id = c.user_id
      WHERE c.id = ${conversationId}
    `;
    if (!conv) return null;
    const msgs = await tx<
      { id: string; question: string; status: string; confidence: MessageView["confidence"]; summary: string; answer: { claims?: MessageView["claims"]; suggestedRephrase?: string | null };
        warnings: Warning[]; mode: MessageView["mode"]; created_at: Date; my_feedback: string | null }[]
    >`
      SELECT m.id, m.question, m.status, m.confidence, m.summary, m.answer, m.warnings, m.mode, m.created_at,
             (SELECT f.rating FROM feedback f WHERE f.message_id = m.id AND f.user_id = ${session.userId}) AS my_feedback
      FROM messages m WHERE m.conversation_id = ${conversationId} ORDER BY m.created_at
    `;
    const cites = await tx<(Citation & { messageId: string })[]>`
      SELECT mc.message_id AS "messageId", mc.ordinal, mc.chunk_id AS "chunkId", mc.source_version_id AS "sourceVersionId",
             mc.source_title AS "sourceTitle", mc.insurer_name AS "insurerName", mc.product_name AS "productName",
             mc.version_number AS "versionNumber", mc.clause_path AS "clausePath", mc.clause_title AS "clauseTitle",
             mc.page_number AS "pageNumber", mc.section_kind AS "sectionKind", mc.quote
      FROM message_citations mc
      WHERE mc.message_id = ANY(${msgs.map((m) => m.id)}::uuid[])
      ORDER BY mc.ordinal
    `;
    const messages: MessageView[] = msgs.map((m) => ({
      id: m.id,
      question: m.question,
      status: m.status,
      confidence: m.confidence,
      summary: m.summary,
      claims: m.answer?.claims ?? [],
      warnings: m.warnings ?? [],
      mode: m.mode,
      createdAt: m.created_at,
      citations: cites.filter((c) => c.messageId === m.id),
      myFeedback: m.my_feedback,
      suggestedRephrase: m.answer?.suggestedRephrase ?? null,
    }));
    return { conversation: conv, messages, isOwner: conv.userId === session.userId };
  });
}

export type ConversationRow = { id: string; title: string; updatedAt: Date; messages: number; lastConfidence: string | null; authorName: string };

export async function listConversations(session: Session, opts: { q?: string; all?: boolean } = {}): Promise<ConversationRow[]> {
  authorize(session, "conversation.read.own");
  const q = (opts.q ?? "").trim().slice(0, 100);
  const all = !!opts.all; // a RLS já limita o corretor às próprias
  return withTenant(session, (tx) =>
    tx<ConversationRow[]>`
      SELECT c.id, c.title, c.updated_at AS "updatedAt", u.name AS "authorName",
             (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id) AS messages,
             (SELECT m.confidence FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS "lastConfidence"
      FROM conversations c JOIN users u ON u.id = c.user_id
      WHERE (${all} OR c.user_id = ${session.userId})
        AND (${q} = '' OR c.title ILIKE ${"%" + q + "%"}
             OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.question ILIKE ${"%" + q + "%"}))
      ORDER BY c.updated_at DESC
      LIMIT 100
    `,
  );
}

export async function giveFeedback(session: Session, input: { messageId: string; rating: string; comment?: string }): Promise<void> {
  authorize(session, "specialist.query");
  if (!isUuid(input.messageId)) throw new Error("Mensagem inválida.");
  if (!["useful", "incomplete", "wrong"].includes(input.rating)) throw new Error("Avaliação inválida.");
  const comment = (input.comment ?? "").trim().slice(0, 2000) || null;
  await withTenant(session, async (tx) => {
    const [m] = await tx`SELECT 1 FROM messages WHERE id = ${input.messageId} AND user_id = ${session.userId}`;
    if (!m) throw new Error("Mensagem não encontrada.");
    await tx`
      INSERT INTO feedback (org_id, message_id, user_id, rating, comment)
      VALUES ((SELECT current_org()), ${input.messageId}, ${session.userId}, ${input.rating}, ${comment})
      ON CONFLICT (message_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = now()
    `;
  });
}

/** Panorama da base para a tela inicial do corretor (nada inventado: contagens reais). */
export async function knowledgeOverview(session: Session) {
  authorize(session, "library.browse");
  return withTenant(session, async (tx) => {
    const [counts] = await tx<{ docs: number; insurers: number }[]>`
      SELECT count(DISTINCT s.id)::int AS docs, count(DISTINCT s.insurer_id)::int AS insurers
      FROM knowledge_sources s JOIN source_versions v ON v.source_id = s.id AND v.is_current
      WHERE s.status = 'active' AND s.deleted_at IS NULL AND v.status IN ('ready','ready_with_warnings')
    `;
    const insurers = await tx<{ id: string; name: string }[]>`
      SELECT DISTINCT i.id, i.name FROM insurers i
      JOIN knowledge_sources s ON s.insurer_id = i.id AND s.status = 'active' AND s.deleted_at IS NULL
      JOIN source_versions v ON v.source_id = s.id AND v.is_current AND v.status IN ('ready','ready_with_warnings')
      ORDER BY i.name
    `;
    const titles = await tx<{ title: string; clause_title: string | null; section_kind: string }[]>`
      SELECT s.title, c.clause_title, c.section_kind
      FROM chunks c JOIN source_versions v ON v.id = c.source_version_id AND v.is_current
      JOIN knowledge_sources s ON s.id = v.source_id AND s.status = 'active'
      WHERE c.clause_title IS NOT NULL AND c.section_kind IN ('coverage','exclusion','waiting_period') AND NOT c.suspicious
      ORDER BY c.created_at DESC LIMIT 40
    `;
    return { docs: counts?.docs ?? 0, insurerCount: counts?.insurers ?? 0, insurers, titles };
  });
}
