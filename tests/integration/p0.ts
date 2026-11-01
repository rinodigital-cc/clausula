/**
 * Teste de integração do FLUXO P0, contra PostgreSQL real, sem mock.
 *
 * Caminho: plataforma cria corretora → proprietário aceita convite → convida
 * corretor → corretor cria acesso → documentos enviados → worker processa →
 * consultas com fonte → histórico → feedback → lacuna vira conhecimento.
 * E o lado negativo: isolamento entre corretoras, convite vencido/usado/de
 * outro e-mail, documento inválido, sem texto, com injeção, vencido,
 * conflito entre fontes e papéis de banco sem privilégio indevido.
 *
 * Rodar: npm run test:integration  (precisa das variáveis de .env.local)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { closePools } from "@/lib/db/client";
import { resolveSession, type Session } from "@/lib/auth/session";
import { createBrokerage } from "@/lib/domain/platform";
import {
  acceptInvitation,
  inviteMember,
  listMembers,
  previewInvitation,
  registerAndAccept,
  removeMember,
} from "@/lib/domain/members";
import { createProduct, listCatalog } from "@/lib/domain/catalog";
import { getPage, getVersionFile, listDocuments, uploadDocument, reprocessVersion } from "@/lib/domain/documents";
import { ask, getConversation, giveFeedback, listConversations } from "@/lib/domain/consult";
import { listGaps, resolveGap } from "@/lib/domain/gaps";
import { requestPasswordReset, resetPassword } from "@/lib/domain/account";
import { submitLead } from "@/lib/domain/leads";
import { processOneJob } from "../../services/worker/ingest";
import { dispatchEmails } from "../../services/worker/email";
import type { CurrentUser } from "@/lib/auth/web";
import { assertDisposableDatabase } from "../safety";

assertDisposableDatabase();

const admin = postgres(process.env.DATABASE_URL_ADMIN!, { onnotice: () => {}, max: 2 });
const worker = postgres(process.env.WORKER_DATABASE_URL!, { onnotice: () => {}, max: 2, prepare: false });
const platformDb = postgres(process.env.PLATFORM_DATABASE_URL!, { onnotice: () => {}, max: 1, prepare: false });
const publicDb = postgres(process.env.PUBLIC_DATABASE_URL!, { onnotice: () => {}, max: 1, prepare: false });

let pass = 0;
let fail = 0;
const results: { id: string; name: string; ok: boolean; detail?: string }[] = [];

function check(id: string, name: string, ok: boolean, detail?: unknown) {
  if (ok) pass++; else fail++;
  results.push({ id, name, ok, detail: ok ? undefined : JSON.stringify(detail)?.slice(0, 400) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id} ${name}${ok ? "" : `\n        → ${JSON.stringify(detail)?.slice(0, 400)}`}`);
}

async function expectThrow(id: string, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  try {
    await fn();
    check(id, name, false, "não lançou");
  } catch (e) {
    const msg = (e as Error).message;
    check(id, name, !match || match.test(msg), msg);
  }
}

const FIX = path.join(__dirname, "..", "fixtures", "pdfs");
function pdf(name: string): File {
  const buf = readFileSync(path.join(FIX, name));
  return new File([buf], name, { type: "application/pdf" });
}
function tokenOf(link: string): string {
  return link.split("/convite/")[1]!;
}
async function drainWorker() {
  const outcomes = [];
  for (;;) {
    const r = await processOneJob(worker);
    if (!r) break;
    outcomes.push(r);
  }
  return outcomes;
}
async function sessionFor(email: string, orgId: string): Promise<Session> {
  const [u] = await admin<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`;
  const s = await resolveSession(u!.id, orgId);
  if (!s) throw new Error(`sem sessão para ${email}`);
  return s;
}

async function main() {
  // ---------------------------------------------------------------- setup
  await admin`
    TRUNCATE email_outbox, leads, lead_rate_limits, usage_events, knowledge_gaps, feedback, message_citations, messages,
             conversations, ingestion_jobs, document_pages, chunk_embeddings, chunks, source_versions, knowledge_sources,
             products, insurers, specialists, org_vector_strategy, rate_limits, password_resets, platform_admins,
             audit_logs, notifications, sessions, invitations, memberships, organizations, users
    RESTART IDENTITY CASCADE`;
  const [pa] = await admin<{ id: string }[]>`INSERT INTO users (email, name) VALUES ('operacao@teste.apoia', 'Operação Apoia') RETURNING id`;
  await admin`INSERT INTO platform_admins (user_id) VALUES (${pa!.id})`;
  const operator: CurrentUser = {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId: pa!.id,
    name: "Operação Apoia",
    email: "operacao@teste.apoia",
    activeOrgId: null,
    isPlatformAdmin: true,
  };

  // ---------------------------------------------------------------- P0.1 corretora
  const a = await createBrokerage(operator, {
    name: "Corretora Horizonte (teste)",
    ownerEmail: "ricardo@horizonte.teste",
    insurers: ["Seguradora Aurora", "Seguradora Atlântica", "Seguradora Boreal", "Assistência Teste"],
    joinAsImplementer: false,
  });
  const b = await createBrokerage(operator, {
    name: "Corretora Serra (teste)",
    ownerEmail: "bia@serra.teste",
    insurers: ["Seguradora Cardeal"],
    joinAsImplementer: false,
  });
  check("P01", "plataforma cria duas corretoras com convite de proprietário", !!a.orgId && !!b.orgId && a.inviteLink.includes("/convite/"));
  const [outboxA] = await admin<{ n: number }[]>`SELECT count(*)::int AS n FROM email_outbox WHERE org_id = ${a.orgId} AND kind = 'invitation'`;
  check("P02", "convite do proprietário vai para a caixa de saída na mesma transação", outboxA?.n === 1, outboxA);

  // ---------------------------------------------------------------- P0.2 aceite do proprietário
  const prev = await previewInvitation(tokenOf(a.inviteLink));
  check("P03", "pré-visualização do convite mostra corretora e papel", prev.state === "valid" && prev.role === "owner", prev);
  await registerAndAccept({ token: tokenOf(a.inviteLink), name: "Ricardo Teste", password: "senha-forte-123" });
  await registerAndAccept({ token: tokenOf(b.inviteLink), name: "Bia Teste", password: "senha-forte-456" });
  const ownerA = await sessionFor("ricardo@horizonte.teste", a.orgId);
  const ownerB = await sessionFor("bia@serra.teste", b.orgId);
  check("P04", "proprietário entra na corretora certa com papel owner", ownerA.role === "owner" && ownerB.role === "owner");
  await expectThrow("P05", "convite já usado não pode ser reutilizado", () =>
    registerAndAccept({ token: tokenOf(a.inviteLink), name: "Outra Pessoa", password: "senha-forte-789" }), /inválido|expirado/i);

  // ---------------------------------------------------------------- P0.3 convite do corretor
  const inv = await inviteMember(ownerA, { email: "marina@horizonte.teste", role: "member" });
  await expectThrow("P06", "convite interno não atribui papel de proprietário", () =>
    inviteMember(ownerA, { email: "x@horizonte.teste", role: "owner" }), /proprietário/);
  await registerAndAccept({ token: tokenOf(inv.link), name: "Marina Corretora", password: "corretora-123" });
  const marina = await sessionFor("marina@horizonte.teste", a.orgId);
  check("P07", "corretor convidado entra como member", marina.role === "member");

  const inv2 = await inviteMember(ownerA, { email: "diego@horizonte.teste", role: "member" });
  await registerAndAccept({ token: tokenOf(inv2.link), name: "Diego Corretor", password: "corretor-456x" });
  const diego = await sessionFor("diego@horizonte.teste", a.orgId);

  // convite vencido
  const inv3 = await inviteMember(ownerA, { email: "atrasado@horizonte.teste", role: "member" });
  await admin`UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE email = 'atrasado@horizonte.teste'`;
  const prevExp = await previewInvitation(tokenOf(inv3.link));
  check("P08", "convite vencido aparece como vencido", prevExp.state === "expired", prevExp);
  await expectThrow("P09", "convite vencido não cria acesso", () =>
    registerAndAccept({ token: tokenOf(inv3.link), name: "Atrasado", password: "atrasado-123x" }), /inválido|expirado/i);

  // convite emitido para outro e-mail
  const inv4 = await inviteMember(ownerA, { email: "certo@horizonte.teste", role: "member" });
  const [diegoUser] = await admin<{ id: string }[]>`SELECT id FROM users WHERE email = 'diego@horizonte.teste'`;
  await expectThrow("P10", "convite não pode ser aceito por conta de outro e-mail", () =>
    acceptInvitation(tokenOf(inv4.link), diegoUser!.id), /outro e-mail/);
  await expectThrow("P11", "senha fraca é recusada no primeiro acesso", () =>
    registerAndAccept({ token: tokenOf(inv4.link), name: "Certo", password: "123" }), /caracteres/);

  // ---------------------------------------------------------------- P0.4 catálogo
  const catA = await listCatalog(ownerA);
  const aurora = catA.find((i) => i.name === "Seguradora Aurora")!;
  const atlantica = catA.find((i) => i.name === "Seguradora Atlântica")!;
  const boreal = catA.find((i) => i.name === "Seguradora Boreal")!;
  const assist = catA.find((i) => i.name === "Assistência Teste")!;
  await createProduct(ownerA, { insurerId: aurora.id, name: "Residencial Essencial", line: "residencial" });
  await createProduct(ownerA, { insurerId: atlantica.id, name: "Casa Atlântica", line: "residencial" });
  await createProduct(ownerA, { insurerId: boreal.id, name: "Auto Boreal", line: "automovel" });
  const catA2 = await listCatalog(ownerA);
  const auroraRes = catA2.find((i) => i.id === aurora.id)!.products[0]!;
  const atlRes = catA2.find((i) => i.id === atlantica.id)!.products[0]!;
  const borealAuto = catA2.find((i) => i.id === boreal.id)!.products[0]!;
  check("P12", "seguradoras e produtos vinculados à corretora", catA2.length === 4 && !!auroraRes && !!borealAuto);
  await expectThrow("P13", "corretor não gerencia catálogo", () =>
    createProduct(marina, { insurerId: aurora.id, name: "Indevido", line: "vida" }), /permissão/);

  // ---------------------------------------------------------------- P0.5 upload
  const up1 = await uploadDocument(ownerA, {
    file: pdf("aurora-residencial-v4.pdf"), title: "CG Residencial Essencial — Aurora (SIMULAÇÃO)",
    insurerId: aurora.id, productId: auroraRes.id, docType: "condicoes_gerais", validFrom: "2026-03-01", rightsConfirmed: true,
  });
  const up2 = await uploadDocument(ownerA, {
    file: pdf("atlantica-residencial-v2.pdf"), title: "CG Casa Atlântica (SIMULAÇÃO)",
    insurerId: atlantica.id, productId: atlRes.id, docType: "condicoes_gerais", rightsConfirmed: true,
  });
  const up3 = await uploadDocument(ownerA, {
    file: pdf("boreal-auto-vencido.pdf"), title: "CG Auto Boreal 2025 (SIMULAÇÃO)",
    insurerId: boreal.id, productId: borealAuto.id, docType: "condicoes_gerais", validFrom: "2025-01-01", validUntil: "2025-12-31", rightsConfirmed: true,
  });
  const up4 = await uploadDocument(ownerA, {
    file: pdf("documento-com-injecao.pdf"), title: "Assistência 24h (SIMULAÇÃO)",
    insurerId: assist.id, docType: "condicoes_gerais", rightsConfirmed: true,
  });
  const up5 = await uploadDocument(ownerA, {
    file: pdf("digitalizado-sem-texto.pdf"), title: "Documento digitalizado (SIMULAÇÃO)", docType: "outro", rightsConfirmed: true,
  });
  const upB = await uploadDocument(ownerB, {
    file: pdf("cardeal-vida-org-b.pdf"), title: "CG Vida Cardeal (SIMULAÇÃO)", docType: "condicoes_gerais", rightsConfirmed: true,
  });
  await expectThrow("P14", "arquivo que não é PDF é recusado (assinatura do conteúdo)", () =>
    uploadDocument(ownerA, { file: pdf("nao-e-pdf.pdf"), title: "Falso", docType: "outro", rightsConfirmed: true }), /PDF válido/);
  await expectThrow("P15", "upload exige confirmação de direito de uso", () =>
    uploadDocument(ownerA, { file: pdf("atlantica-residencial-v2.pdf"), title: "X", docType: "outro", rightsConfirmed: false }), /direito/);
  await expectThrow("P16", "o mesmo arquivo não entra duas vezes", () =>
    uploadDocument(ownerA, { file: pdf("aurora-residencial-v4.pdf"), title: "Duplicado", docType: "outro", rightsConfirmed: true }), /já foi enviado/);
  await expectThrow("P17", "corretor não envia documento", () =>
    uploadDocument(marina, { file: pdf("atlantica-residencial-v2.pdf"), title: "X", docType: "outro", rightsConfirmed: true }), /permissão/);

  const before = await listDocuments(ownerA);
  check("P18", "antes do worker, nada aparece como pronto", before.every((d) => d.status === "queued"), before.map((d) => d.status));
  const marinaBefore = await listDocuments(marina);
  check("P19", "corretor não vê documento que ainda não está pronto", marinaBefore.length === 0, marinaBefore.length);

  // ---------------------------------------------------------------- P0.6 ingestão
  const outcomes = await drainWorker();
  const by = (v: string) => outcomes.find((o) => o.versionId === v)?.status;
  check("P20", "PDF de condições gerais processado: pronto", by(up1.versionId) === "ready", outcomes);
  check("P21", "documento com instrução escondida: pronto com ressalvas", by(up4.versionId) === "ready_with_warnings", by(up4.versionId));
  check("P22", "PDF sem texto (digitalizado) falha com motivo claro", by(up5.versionId) === "failed", outcomes.find((o) => o.versionId === up5.versionId));
  const [failedRow] = await admin<{ error_message: string }[]>`SELECT error_message FROM source_versions WHERE id = ${up5.versionId}`;
  check("P23", "mensagem de falha é legível para o administrador", /digitalizado|texto/i.test(failedRow?.error_message ?? ""), failedRow);
  const [cl] = await admin<{ n: number }[]>`SELECT count(*)::int AS n FROM chunks WHERE source_version_id = ${up1.versionId} AND clause_path IS NOT NULL`;
  check("P24", "documento dividido por cláusula (com número de cláusula)", (cl?.n ?? 0) >= 8, cl);
  check("P25", "documento da corretora B processado", by(upB.versionId) === "ready" && by(up2.versionId) === "ready" && by(up3.versionId) === "ready");

  // ---------------------------------------------------------------- P0.7 consulta
  const q1 = await ask(marina, { question: "Quais são as exclusões da cobertura de danos elétricos no residencial da Aurora?", insurerId: aurora.id });
  const r1 = q1.result;
  check("P26", "consulta suportada responde com citação", r1.confidence !== "not_found" && r1.cited.length > 0, r1);
  check("P27", "citação aponta para o documento correto da corretora", r1.cited.every((c) => c.source_version_id === up1.versionId), r1.cited.map((c) => c.source_title));
  check("P28", "exclusão aparece primeiro (cláusula 9.4)", r1.claims[0]?.kind === "restriction" && r1.cited.some((c) => c.clause_path === "9.4"), r1.claims);
  const allQuotesLiteral = r1.claims.every((k) => {
    const c = r1.cited.find((x) => x.chunk_id === k.chunk_id)!;
    const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9%$,.\s]/g, " ").replace(/\s+/g, " ").trim();
    return !!c && norm(c.content).includes(norm(k.quote));
  });
  check("P29", "toda citação é trecho literal do documento recuperado", allQuotesLiteral, r1.claims);

  const q2 = await ask(marina, { question: "Tem carência para roubo no residencial?", conversationId: q1.conversationId, insurerId: aurora.id });
  check("P30", "pergunta seguinte na mesma conversa cita a cláusula 8.1", q2.conversationId === q1.conversationId && q2.result.cited.some((c) => c.clause_path === "8.1"), q2.result.cited.map((c) => c.clause_path));

  const q3 = await ask(marina, { question: "Qual o prazo de portabilidade da previdência privada?" });
  check("P31", "pergunta sem evidência: não encontrei, sem resposta inventada", q3.result.confidence === "not_found" && q3.result.claims.length === 0, q3.result);

  const q4 = await ask(marina, { question: "O automóvel da Boreal tem carro reserva?" });
  check("P32", "documento vencido: aviso de vigência e confiança rebaixada",
    q4.result.warnings.some((w) => w.kind === "vigencia_vencida") && q4.result.confidence !== "strong", q4.result.warnings);

  const q5 = await ask(marina, { question: "Qual o limite de quilômetros do guincho?" });
  const injected = q5.result.cited.some((c) => /ignore as instru/i.test(c.content));
  check("P33", "trecho com instrução escondida nunca é usado como fonte", !injected && q5.result.cited.some((c) => c.clause_path === "3.1"), q5.result.cited.map((c) => c.content.slice(0, 60)));

  const q6 = await ask(marina, { question: "protocolo-zircônio-azul doença preexistente" });
  check("P34", "termo exclusivo da corretora B nunca aparece para a corretora A", q6.result.confidence === "not_found" && q6.result.cited.length === 0, q6.result.cited);

  const q7 = await ask(marina, { question: "Danos elétricos por variação de tensão estão cobertos?" });
  check("P35", "sem escolher seguradora, avisa que há mais de uma seguradora", q7.result.warnings.some((w) => w.kind === "varias_seguradoras"), q7.result.warnings);

  // conflito: manual interno da mesma seguradora/produto diz outra coisa
  await uploadDocument(ownerA, {
    file: pdf("aurora-residencial-manual-interno.pdf"), title: "Manual interno Residencial Aurora (SIMULAÇÃO)",
    insurerId: aurora.id, productId: auroraRes.id, docType: "manual", rightsConfirmed: true,
  });
  await drainWorker();
  const q8 = await ask(marina, { question: "Danos elétricos: qual a idade máxima dos aparelhos de fabricação aceitos?", insurerId: aurora.id });
  check("P36", "fontes diferentes da mesma seguradora/produto são sinalizadas como conflito",
    q8.result.status === "conflict" && q8.result.warnings.some((w) => w.kind === "fontes_diferentes"), { status: q8.result.status, w: q8.result.warnings, cited: q8.result.cited.map((c) => c.source_title) });

  // ---------------------------------------------------------------- P0.8 histórico e documento
  const conv = await getConversation(marina, q1.conversationId);
  check("P37", "histórico guarda perguntas, respostas e citações", (conv?.messages.length ?? 0) === 2 && (conv?.messages[0]?.citations.length ?? 0) > 0, conv?.messages.length);
  const cite = conv!.messages[0]!.citations[0]!;
  const page = await getPage(marina, cite.sourceVersionId!, cite.pageNumber ?? 1);
  check("P38", "corretor abre a página citada do documento", !!page && page.content.length > 50 && page.page === cite.pageNumber, page?.page);
  const file = await getVersionFile(marina, up1.versionId);
  check("P39", "corretor abre o original autorizado", !!file?.fileKey);
  await giveFeedback(marina, { messageId: q1.messageId, rating: "useful" });
  await giveFeedback(marina, { messageId: q1.messageId, rating: "incomplete", comment: "Faltou a franquia" });
  const [fb] = await admin<{ n: number; rating: string }[]>`SELECT count(*)::int AS n, max(rating) AS rating FROM feedback`;
  check("P40", "feedback gravado (uma avaliação por pessoa, atualizável)", fb?.n === 1 && fb.rating === "incomplete", fb);

  // ---------------------------------------------------------------- isolamento
  check("I01", "corretora B não abre documento da corretora A", (await getVersionFile(ownerB, up1.versionId)) === null);
  check("I02", "corretora B não lê página da corretora A", (await getPage(ownerB, up1.versionId, 1)) === null);
  check("I03", "corretora B não lê conversa da corretora A", (await getConversation(ownerB, q1.conversationId)) === null);
  check("I04", "corretora A não abre documento da corretora B", (await getVersionFile(ownerA, upB.versionId)) === null);
  check("I05", "outro corretor da MESMA corretora não lê a conversa da Marina", (await getConversation(diego, q1.conversationId)) === null);
  check("I06", "administração da corretora lê a conversa (qualidade)", (await getConversation(ownerA, q1.conversationId)) !== null);
  const diegoList = await listConversations(diego, { all: true });
  check("I07", "lista de histórico do Diego não traz conversas da Marina", diegoList.length === 0, diegoList.length);
  const bDocs = await listDocuments(ownerB);
  check("I08", "biblioteca da B só tem os documentos da B", bDocs.length === 1 && bDocs[0]!.title.includes("Cardeal"), bDocs.map((d) => d.title));
  await expectThrow("I09", "objeto de sessão forjado (spread) é recusado", () =>
    getVersionFile({ ...ownerB, orgId: a.orgId } as Session, up1.versionId), /Sessão não verificada|permissão/);
  await expectThrow("I10", "papel de plataforma não lê trechos de documentos", () => platformDb`SELECT count(*) FROM chunks`, /permission denied/);
  await expectThrow("I11", "papel do worker não lê usuários", () => worker`SELECT count(*) FROM users`, /permission denied/);
  await expectThrow("I12", "formulário público não lê leads", () => publicDb`SELECT count(*) FROM leads`, /permission denied/);
  await expectThrow("I13", "worker sem contexto de corretora não lê trechos (falha fechada)", () => worker`SELECT count(*) FROM chunks`, /current_org|contexto/);

  // ---------------------------------------------------------------- lacuna → conhecimento interno
  const gaps = await listGaps(ownerA);
  check("G01", "pergunta sem resposta virou lacuna para a administração", gaps.some((g) => /portabilidade/i.test(g.question)), gaps.map((g) => g.question));
  const gap = gaps.find((g) => /portabilidade/i.test(g.question))!;
  await resolveGap(ownerA, {
    gapId: gap.id,
    title: "Portabilidade de previdência (procedimento da corretora)",
    answer: "A portabilidade de previdência privada é solicitada pelo cliente na entidade de destino. O prazo de transferência informado pelo nosso time é de até 5 dias úteis após o pedido. Confirmar sempre com a entidade de destino.",
  });
  const q9 = await ask(marina, { question: "Qual o prazo de portabilidade da previdência privada?" });
  check("G02", "conhecimento interno passa a responder, com citação", q9.result.confidence !== "not_found" && q9.result.cited.some((c) => c.doc_type === "nota_interna"), q9.result);
  const [notif] = await admin<{ n: number }[]>`SELECT count(*)::int AS n FROM notifications WHERE kind = 'gap_resolved'`;
  check("G03", "quem perguntou é avisado", notif?.n === 1, notif);

  // ---------------------------------------------------------------- reprocessar, remoção, senha, leads
  await reprocessVersion(ownerA, up1.versionId);
  const again = await drainWorker();
  check("R01", "reprocessar documento funciona (worker tem DELETE)", again.some((o) => o.versionId === up1.versionId && o.status === "ready"), again);

  const [dSess] = await admin<{ id: string }[]>`
    INSERT INTO sessions (user_id, token_hash, active_org_id, expires_at)
    VALUES (${diegoUser!.id}, 'hash-teste-diego', ${a.orgId}, now() + interval '1 day') RETURNING id`;
  await removeMember(ownerA, diegoUser!.id);
  const [revoked] = await admin<{ revoked_at: Date | null }[]>`SELECT revoked_at FROM sessions WHERE id = ${dSess!.id}`;
  check("R02", "remover corretor revoga a sessão na hora", !!revoked?.revoked_at);
  check("R03", "corretor removido não obtém mais sessão de tenant", (await resolveSession(diegoUser!.id, a.orgId)) === null);
  const members = await listMembers(ownerA);
  check("R04", "equipe lista proprietário e corretores", members.some((m) => m.role === "owner") && members.length >= 3, members.length);

  await requestPasswordReset("marina@horizonte.teste");
  await requestPasswordReset("ninguem@nao.existe");
  const [mail] = await admin<{ body_text: string }[]>`SELECT body_text FROM email_outbox WHERE kind = 'password_reset' ORDER BY created_at DESC LIMIT 1`;
  const resetToken = mail?.body_text.match(/\/redefinir\/([A-Za-z0-9_-]+)/)?.[1];
  const [resets] = await admin<{ n: number }[]>`SELECT count(*)::int AS n FROM password_resets`;
  check("R05", "redefinição só gera link para e-mail existente", !!resetToken && resets?.n === 1, resets);
  await resetPassword(resetToken!, "nova-senha-2026");
  await expectThrow("R06", "link de redefinição é de uso único", () => resetPassword(resetToken!, "outra-senha-2026"), /inválido|expirado/i);

  const lead0 = await submitLead({ name: "", email: "x", consent: false });
  check("L01", "formulário valida nome, e-mail e consentimento", !lead0.ok && Object.keys(lead0.errors).length === 3, lead0);
  const leadBot = await submitLead({ name: "Robô", email: "robo@x.com", consent: true, website: "spam.com" });
  const leadOk = await submitLead({ name: "Paula Corretora", email: "paula@corretora.teste", company: "Corretora Teste", teamSize: "2-5", interest: "piloto", consent: true, ip: "10.0.0.1" });
  const [leads] = await admin<{ n: number }[]>`SELECT count(*)::int AS n FROM leads`;
  check("L02", "lead válido gravado; robô (armadilha) descartado sem gravar", leadBot.ok && leadOk.ok && leads?.n === 1, leads);
  for (let i = 0; i < 5; i++) await submitLead({ name: "Paula", email: `p${i}@x.teste`, consent: true, ip: "10.0.0.2" });
  const limited = await submitLead({ name: "Paula", email: "p9@x.teste", consent: true, ip: "10.0.0.2" });
  check("L03", "limite de envios por IP", !limited.ok, limited);

  const disp = await dispatchEmails(worker, 100);
  check("E01", "sem provedor configurado, e-mails NÃO são marcados como enviados", disp.sent === 0 && disp.skipped > 0, disp);

  // Regressão: JSON gravado como objeto/lista, não como texto dentro do jsonb (a tela lia uma string).
  const [jt] = await admin<{ w: string; a: string; ws: string | null }[]>`
    SELECT (SELECT jsonb_typeof(warnings) FROM messages LIMIT 1) AS w, (SELECT jsonb_typeof(answer) FROM messages LIMIT 1) AS a,
           (SELECT jsonb_typeof(warning_summary) FROM source_versions WHERE warning_summary IS NOT NULL LIMIT 1) AS ws`;
  check("J01", "avisos e resposta ficam gravados como JSON estruturado", jt?.w === "array" && jt?.a === "object" && (jt?.ws ?? "object") === "object", jt);

  // Regressão: no modo literal, um termo em comum (“carência”) não basta para citar um trecho de outro assunto.
  const r01 = await ask(marina, { question: "Quanto tempo de carência para doença preexistente no vida em grupo?" });
  check("R10", "modo literal não cita trecho de outro assunto por um único termo em comum", r01.result.confidence === "not_found" && r01.result.cited.length === 0, r01.result.cited.map((c) => c.content.slice(0, 60)));

  // ---------------------------------------------------------------- resumo
  console.log(`\n${pass} de ${pass + fail} casos PASSARAM`);
  const fs = await import("node:fs");
  fs.mkdirSync(path.join(__dirname, "..", "..", "test-results"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "..", "..", "test-results", "integration-p0.json"), JSON.stringify({ when: new Date().toISOString(), pass, fail, results }, null, 2));
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("ERRO NA SUÍTE:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePools();
    await Promise.all([admin.end(), worker.end(), platformDb.end(), publicDb.end()]);
  });
