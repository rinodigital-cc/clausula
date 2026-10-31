import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { dispatchEmails } from "../../services/worker/email";

test("transporte file não envia e-mail mesmo com chave configurada", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "apoia-email-"));
  const saved = { ...process.env };
  const original = globalThis.fetch;
  const updates: string[] = [];
  const sql = async (parts: TemplateStringsArray) => {
    const query = parts.join("?");
    if (query.includes("SELECT")) return [{ id: "simulacao", to_email: "teste@example.test", subject: "SIMULAÇÃO", body_text: "Teste", body_html: "<p>Teste</p>", attempts: 0 }];
    updates.push(query);
    return [];
  };
  try {
    process.env.EMAIL_TRANSPORT = "file";
    process.env.RESEND_API_KEY = "SIMULACAO-SEM-VALOR";
    process.env.EMAIL_FROM = "teste@example.test";
    process.env.STORAGE_DIR = dir;
    globalThis.fetch = async () => { throw new Error("Transporte file não pode fazer requisição HTTP"); };
    const result = await dispatchEmails(sql as unknown as Parameters<typeof dispatchEmails>[0]);
    assert.deepEqual(result, { sent: 0, skipped: 1, failed: 0 });
    assert.deepEqual(await readdir(path.join(dir, "outbox")), ["simulacao.eml"]);
    assert.ok(updates.some(query => query.includes("'skipped'")));
    assert.ok(updates.every(query => !query.includes("'sent'")));
  } finally {
    globalThis.fetch = original;
    for (const key of ["EMAIL_TRANSPORT", "RESEND_API_KEY", "EMAIL_FROM", "STORAGE_DIR"]) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
    await rm(dir, { recursive: true, force: true });
  }
});
