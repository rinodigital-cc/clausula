import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  applyProviderEvent, backoffMinutes, dispatchEmails, isPermanentStatus, mapProviderEvent, shouldAdvance,
} from "../../services/worker/email";
import { verifyWebhookSignature } from "../../src/lib/email/webhook";
import { accessState } from "../../src/lib/domain/access-state";
import {
  brokerageInvitationEmail, emailConfirmationEmail, invitationEmail, passwordChangedEmail, passwordResetEmail, welcomeEmail,
} from "../../src/lib/email/outbox";

type Row = Record<string, unknown>;
type Call = { query: string; values: unknown[] };

function fakeSql(responder: (query: string, values: unknown[]) => Row[]) {
  const calls: Call[] = [];
  const sql = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.join("?");
    calls.push({ query, values });
    return responder(query, values);
  };
  return { sql: sql as unknown as Parameters<typeof dispatchEmails>[0], calls };
}

const PENDING = { id: "0190a000-0000-7000-8000-000000000001", to_email: "teste@example.test", subject: "SIMULAÇÃO", body_text: "Teste", body_html: "<p>Teste</p>", attempts: 0 };

async function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>) {
  const saved = { ...process.env };
  const original = globalThis.fetch;
  try {
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await fn();
  } finally {
    process.env = saved;
    globalThis.fetch = original;
  }
}
const PROVIDER = { EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "SIMULACAO-SEM-VALOR", EMAIL_FROM: "Vera.ia <acesso@example.test>", VERCEL: undefined };

test("aceite do provedor grava id e estado 'aceito' (não 'entregue')", async () => withEnv(PROVIDER, async () => {
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.from, PROVIDER.EMAIL_FROM);
    assert.equal(new Headers(init?.headers).get("Idempotency-Key"), `apoia-email-${PENDING.id}`);
    return new Response(JSON.stringify({ id: "re-simulado-123" }), { status: 200 });
  };
  const { sql, calls } = fakeSql((q) => q.includes("count(*)") ? [{ n: 0 }] : q.includes("SELECT id, to_email") ? [PENDING] : []);
  const r = await dispatchEmails(sql);
  assert.deepEqual(r, { sent: 1, skipped: 0, failed: 0, deferred: 0 });
  const update = calls.find((c) => c.query.includes("status = 'sent'"))!;
  assert.ok(update.query.includes("delivery_status = 'accepted'"));
  assert.ok(update.values.includes("re-simulado-123"));
  assert.ok(!update.query.includes("'delivered'"));
}));

test("erro permanente (422) falha na hora; 429 volta para a fila com espera", async () => withEnv(PROVIDER, async () => {
  for (const [status, final] of [[422, true], [429, false]] as const) {
    globalThis.fetch = async () => new Response(JSON.stringify({ name: "validation_error", message: "domínio não verificado re_abc" }), { status });
    const { sql, calls } = fakeSql((q) => q.includes("count(*)") ? [{ n: 0 }] : q.includes("SELECT id, to_email") ? [PENDING] : []);
    const r = await dispatchEmails(sql);
    assert.equal(r.failed, 1);
    const update = calls.find((c) => c.query.includes("last_error"))!;
    assert.equal(update.values.includes("failed"), final, `status ${status}`);
    const message = update.values.find((v) => typeof v === "string" && v.startsWith("Resend")) as string;
    assert.ok(message.includes(String(status)));
    assert.ok(!message.includes("re_abc"), "não vaza identificadores de chave");
  }
  assert.equal(isPermanentStatus(500), false);
  assert.deepEqual([0, 1, 2, 3, 10].map(backoffMinutes), [1, 2, 4, 8, 60]);
}));

test("teto diário adia o envio sem chamar o provedor", async () => withEnv({ ...PROVIDER, EMAIL_DAILY_CAP: "3" }, async () => {
  globalThis.fetch = async () => { throw new Error("não pode enviar acima do teto"); };
  const { sql, calls } = fakeSql((q) => q.includes("count(*)") ? [{ n: 3 }] : q.includes("SELECT id, to_email") ? [PENDING] : []);
  const r = await dispatchEmails(sql);
  assert.deepEqual(r, { sent: 0, skipped: 0, failed: 0, deferred: 1 });
  assert.ok(calls.some((c) => c.query.includes("next_attempt_at = now() + interval '1 hour'")));
}));

test("eventos do provedor: mapeamento, sem regressão e idempotência", async () => {
  assert.equal(mapProviderEvent("email.delivered"), "delivered");
  assert.equal(mapProviderEvent("email.sent"), "accepted");
  assert.equal(mapProviderEvent("bounced"), "bounced");
  assert.equal(mapProviderEvent("email.opened"), null);
  assert.equal(shouldAdvance("delivered", "delivery_delayed"), false);
  assert.equal(shouldAdvance("accepted", "delivered"), true);
  assert.equal(shouldAdvance("delivered", "complained"), true);

  let seen = false;
  const { sql, calls } = fakeSql((q) => {
    if (q.includes("FROM email_outbox WHERE provider_message_id")) return [{ id: "m1", delivery_status: "accepted" }];
    if (q.includes("INSERT INTO email_events")) { if (seen) return []; seen = true; return [{ id: "e1" }]; }
    return [];
  });
  const ev = { eventId: "msg_1", type: "email.delivered", messageId: "re-1" };
  assert.equal(await applyProviderEvent(sql, ev), true);
  assert.equal(await applyProviderEvent(sql, ev), false, "mesmo evento duas vezes não reaplica");
  assert.equal(calls.filter((c) => c.query.includes("UPDATE email_outbox")).length, 1);
});

test("assinatura de webhook: aceita válida, recusa adulterada, antiga ou sem segredo", () => {
  const key = Buffer.from("segredo-de-teste-simulado");
  const secret = `whsec_${key.toString("base64")}`;
  const now = 1_800_000_000;
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re-1" } });
  const sign = (id: string, ts: number, b: string) => `v1,${createHmac("sha256", key).update(`${id}.${ts}.${b}`).digest("base64")}`;
  const h = { id: "msg_1", timestamp: String(now), signature: `v1,invalida ${sign("msg_1", now, body)}` };
  assert.equal(verifyWebhookSignature(secret, h, body, now), true);
  assert.equal(verifyWebhookSignature(secret, h, body.replace("delivered", "bounced"), now), false);
  assert.equal(verifyWebhookSignature(secret, h, body, now + 600), false);
  assert.equal(verifyWebhookSignature("", h, body, now), false);
  assert.equal(verifyWebhookSignature(secret, { ...h, signature: null }, body, now), false);
});

test("estado operacional do acesso distingue enviado, entregue, expirado, falha e ativo", () => {
  const base = { ownerEmail: null, ownerPending: "r@example.test", inviteExpiresAt: new Date(Date.now() + 864e5), emailStatus: "pending", deliveryStatus: null };
  assert.equal(accessState(base), "awaiting_send");
  assert.equal(accessState({ ...base, emailStatus: "sent", deliveryStatus: "accepted" }), "sent");
  assert.equal(accessState({ ...base, emailStatus: "sent", deliveryStatus: "delivered" }), "delivered");
  assert.equal(accessState({ ...base, emailStatus: "sent", deliveryStatus: "bounced" }), "failed");
  assert.equal(accessState({ ...base, emailStatus: "failed" }), "failed");
  assert.equal(accessState({ ...base, inviteExpiresAt: new Date(Date.now() - 1000) }), "expired");
  assert.equal(accessState({ ...base, ownerEmail: "r@example.test" }), "active");
  assert.equal(accessState({ ...base, ownerPending: null }), "no_invite");
  assert.equal(accessState({ ...base, emailStatus: "skipped" }), "not_sent");
});

test("templates: assunto oficial, HTML compatível, texto simples, sem script nem senha, com escape", () => {
  const link = "https://homolog.example.test/convite/tok";
  const all = [
    brokerageInvitationEmail({ orgId: "o", to: "a@example.test", orgName: "Corretora <Teste>", link, expiresDays: 7 }),
    brokerageInvitationEmail({ orgId: "o", to: "a@example.test", orgName: "Corretora", link, expiresDays: 7, resend: true }),
    invitationEmail({ orgId: "o", to: "a@example.test", orgName: "Corretora", inviterName: "Ana", roleLabel: "Membro", link, expiresDays: 7 }),
    passwordResetEmail({ to: "a@example.test", link, firstAccess: true }),
    passwordResetEmail({ to: "a@example.test", link, firstAccess: false }),
    emailConfirmationEmail({ to: "a@example.test", link, expiresHours: 24 }),
    welcomeEmail({ orgId: "o", to: "a@example.test", name: "Ana Souza", orgName: "Corretora", link }),
    passwordChangedEmail({ to: "a@example.test", recoverLink: link, when: new Date("2026-11-26T12:00:00Z") }),
  ];
  assert.equal(all[0]!.subject, "Você foi convidado para acessar a Vera.ia");
  assert.ok(all[0]!.html.includes("Bem-vindo à Vera.ia."));
  assert.ok(all[0]!.html.includes("Criar minha senha"));
  assert.ok(all[0]!.text.includes("Vera.ia — Conhecimento que dá segurança."));
  assert.ok(all[0]!.html.includes("Corretora &lt;Teste&gt;") && !all[0]!.html.includes("<Teste>"));
  assert.equal(new Set(all.map((m) => m.kind)).size, all.length, "cada template tem tipo próprio");
  for (const m of all) {
    assert.ok(m.text.length > 40 && !/<(p|a|table|td|b|br|span)[\s>]/i.test(m.text), `${m.kind}: texto simples`);
    assert.ok(!/<script|javascript:/i.test(m.html), `${m.kind}: sem script`);
    assert.ok(m.html.includes('role="presentation"'), `${m.kind}: layout em tabela`);
    assert.ok(!/\$\{|undefined|NaN/.test(m.html + m.text), `${m.kind}: sem placeholder vazio`);
    assert.ok(!/ApoIA|Apoia Seguro/.test(m.html + m.subject), `${m.kind}: marca atual`);
    assert.ok(!/senha:\s*\S/i.test(m.text), `${m.kind}: nunca envia senha`);
  }
});
