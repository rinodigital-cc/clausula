import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";

/**
 * Armazenamento de arquivos originais.
 *
 * Chave opaca prefixada pela organização: `<org_id>/<uuid>.pdf`. O nome
 * original do arquivo nunca entra no caminho (evita travessia de diretório e
 * vazamento de nome). O acesso ao arquivo SEMPRE passa por uma rota que
 * primeiro confirma, sob RLS, que a versão pertence à corretora da sessão.
 *
 * Disco persistente no Docker ou bucket privado Supabase no serverless.
 * Nunca retorna URL pública; autorização acontece antes de readOriginal.
 */
const root = () => path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR ?? "./storage");

const KEY_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/;

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Verificação por assinatura do conteúdo, não por extensão nem por tipo declarado. */
export function looksLikePdf(buf: Uint8Array): boolean {
  if (buf.length < 8) return false;
  const head = Buffer.from(buf.subarray(0, 1024)).toString("latin1");
  return head.startsWith("%PDF-") || head.includes("%PDF-");
}

function backend(): "local" | "supabase" {
  const driver = process.env.STORAGE_DRIVER ?? (process.env.VERCEL ? "supabase" : "local");
  if (driver !== "local" && driver !== "supabase") throw new Error("STORAGE_DRIVER inválido");
  if (process.env.VERCEL && driver === "local") throw new Error("Disco efêmero não pode armazenar PDFs na Vercel");
  return driver;
}

function objectConfig(key: string) {
  const raw = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_STORAGE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET;
  if (!raw || !secret || !bucket || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(bucket)) {
    throw new Error("Armazenamento persistente não configurado");
  }
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("SUPABASE_URL deve ser uma origem HTTPS");
  }
  return {
    url: `${url.origin}/storage/v1/object/${bucket}/${key}`,
    headers: { apikey: secret, Authorization: `Bearer ${secret}` },
  };
}

export async function saveOriginal(orgId: string, data: Uint8Array): Promise<string> {
  const key = `${orgId}/${randomUUID()}.pdf`;
  if (!KEY_RE.test(key)) throw new Error("Organização inválida");
  if (data.length > MAX_UPLOAD_BYTES || !looksLikePdf(data)) throw new Error("PDF inválido ou acima do limite");
  if (backend() === "supabase") {
    const config = objectConfig(key);
    const response = await fetch(config.url, {
      method: "POST", headers: { ...config.headers, "Content-Type": "application/pdf", "x-upsert": "false" },
      body: new Uint8Array(data), signal: AbortSignal.timeout(30_000), redirect: "error",
    });
    if (!response.ok) throw new Error(`Falha ao armazenar PDF (${response.status})`);
    return key;
  }
  const full = path.join(/*turbopackIgnore: true*/ root(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data, { flag: "wx" });
  return key;
}

export async function readOriginal(key: string): Promise<Buffer> {
  if (!KEY_RE.test(key)) throw new Error("Chave de armazenamento inválida");
  if (backend() === "supabase") {
    const config = objectConfig(key);
    const response = await fetch(config.url, {
      headers: config.headers, cache: "no-store", signal: AbortSignal.timeout(30_000), redirect: "error",
    });
    if (!response.ok) throw new Error(`Arquivo original indisponível (${response.status})`);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > MAX_UPLOAD_BYTES || !looksLikePdf(data)) throw new Error("PDF armazenado inválido");
    return data;
  }
  const full = path.join(/*turbopackIgnore: true*/ root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("Caminho fora do armazenamento");
  return readFile(full);
}
