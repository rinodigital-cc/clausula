import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { assertDisposableDatabase } from "../safety";
import { closePools } from "@/lib/db/client";
import { hashPassword } from "@/lib/auth/password";
import type { CurrentUser } from "@/lib/auth/web";
import { createBrokerage } from "@/lib/domain/platform";
import { registerAndAccept } from "@/lib/domain/members";
import { resolveSession } from "@/lib/auth/session";
import { uploadDocument } from "@/lib/domain/documents";
import { processOneJob } from "@services/worker/ingest";

assertDisposableDatabase();
const admin = postgres(process.env.DATABASE_URL_ADMIN!, { max: 1, onnotice: () => {} });
const worker = postgres(process.env.WORKER_DATABASE_URL!, { max: 1, onnotice: () => {} });

async function seed() {
  // Apenas o banco local _test: todos os nomes e documentos são SIMULAÇÃO.
  await admin`TRUNCATE email_outbox, leads, lead_rate_limits, usage_events, knowledge_gaps, feedback,
    message_citations, messages, conversations, ingestion_jobs, document_pages, chunk_embeddings, chunks,
    source_versions, knowledge_sources, products, insurers, specialists, org_vector_strategy, rate_limits,
    password_resets, platform_admins, audit_logs, notifications, sessions, invitations, memberships,
    organizations, users RESTART IDENTITY CASCADE`;
  const password = "senha-simulacao-123";
  const [operator] = await admin<{ id: string }[]>`INSERT INTO users (email, name, password_hash)
    VALUES ('operacao@apoia.test', 'Operação (SIMULAÇÃO)', ${await hashPassword(password)}) RETURNING id`;
  await admin`INSERT INTO platform_admins (user_id) VALUES (${operator!.id})`;
  const actor: CurrentUser = { sessionId: "00000000-0000-0000-0000-000000000000", userId: operator!.id,
    name: "Operação (SIMULAÇÃO)", email: "operacao@apoia.test", activeOrgId: null, isPlatformAdmin: true };
  const a = await createBrokerage(actor, { name: "Corretora Aurora (SIMULAÇÃO)", ownerEmail: "ana@aurora.test", insurers: [], joinAsImplementer: false });
  const b = await createBrokerage(actor, { name: "Corretora Cardeal (SIMULAÇÃO)", ownerEmail: "bia@cardeal.test", insurers: [], joinAsImplementer: false });
  const ownerA = await registerAndAccept({ token: a.inviteLink.split("/convite/")[1]!, name: "Ana (SIMULAÇÃO)", password });
  const ownerB = await registerAndAccept({ token: b.inviteLink.split("/convite/")[1]!, name: "Bia (SIMULAÇÃO)", password });
  const sessionA = (await resolveSession(ownerA.userId, a.orgId))!;
  const sessionB = (await resolveSession(ownerB.userId, b.orgId))!;
  const pdf = (name: string) => new File([readFileSync(`tests/fixtures/pdfs/${name}`)], name, { type: "application/pdf" });
  const docA = await uploadDocument(sessionA, { file: pdf("aurora-residencial-v4.pdf"), title: "Residencial Aurora (SIMULAÇÃO)", docType: "condicoes_gerais", rightsConfirmed: true });
  const docB = await uploadDocument(sessionB, { file: pdf("cardeal-vida-org-b.pdf"), title: "Vida Cardeal (SIMULAÇÃO)", docType: "condicoes_gerais", rightsConfirmed: true });
  while (await processOneJob(worker)) { /* esvazia somente a fila local */ }
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/e2e-fixture.json", JSON.stringify({ orgA: a.orgId, orgB: b.orgId, docA, docB }));
  console.log("Fixtures E2E locais preparadas (SIMULAÇÃO).");
}

seed().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await closePools(); await worker.end(); await admin.end(); });
