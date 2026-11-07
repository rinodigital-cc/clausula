import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readOriginal, saveOriginal } from "../../src/lib/storage";

const org = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const pdf = Buffer.from("%PDF-1.7\nStorage integration contract");

test("storage: persistência local, validação e rejeição de disco efêmero", async () => {
  const saved = { ...process.env };
  const dir = await mkdtemp(path.join(tmpdir(), "apoia-storage-"));
  try {
    delete process.env.VERCEL;
    process.env.STORAGE_DRIVER = "local";
    process.env.STORAGE_DIR = dir;
    const key = await saveOriginal(org, pdf);
    assert.deepEqual(await readOriginal(key), pdf);
    await assert.rejects(readOriginal("../secret"));
    await assert.rejects(saveOriginal("../outside", pdf));
    await assert.rejects(saveOriginal(org, Buffer.from("not pdf")));
    process.env.VERCEL = "1";
    await assert.rejects(saveOriginal(org, pdf), /efêmero/);
  } finally {
    process.env = saved;
    await rm(dir, { recursive: true, force: true });
  }
});

test("storage: upload e download autenticados, falhas sem vazamento nem fallback", async () => {
  const saved = { ...process.env };
  const originalFetch = globalThis.fetch;
  const objects = new Map<string, Uint8Array>();
  try {
    process.env.STORAGE_DRIVER = "supabase";
    process.env.SUPABASE_URL = "https://storage.example.test";
    process.env.SUPABASE_STORAGE_BUCKET = "private-pdfs";
    process.env.SUPABASE_STORAGE_KEY = "TEST-SECRET-NEVER-REAL";
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      assert.ok(url.startsWith("https://storage.example.test/storage/v1/object/private-pdfs/"));
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer TEST-SECRET-NEVER-REAL");
      assert.equal(init?.redirect, "error");
      if (init?.method === "POST") {
        assert.equal(new Headers(init.headers).get("x-upsert"), "false");
        objects.set(url, init.body as Uint8Array);
        return new Response("{}", { status: 200 });
      }
      assert.equal(init?.cache, "no-store");
      return new Response(new Uint8Array(objects.get(url)!), { status: 200 });
    };
    const key = await saveOriginal(org, pdf);
    assert.deepEqual(await readOriginal(key), pdf);
    globalThis.fetch = async () => new Response("sensitive provider detail", { status: 403 });
    await assert.rejects(readOriginal(key), { message: "Arquivo original indisponível (403)" });
    await assert.rejects(saveOriginal(org, pdf), { message: "Falha ao armazenar PDF (403)" });
    delete process.env.SUPABASE_STORAGE_KEY;
    await assert.rejects(saveOriginal(org, pdf), /não configurado/);
  } finally {
    process.env = saved;
    globalThis.fetch = originalFetch;
  }
});
