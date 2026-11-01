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
 * Implementação atual: disco local (STORAGE_DIR). Em produção, trocar por
 * bucket S3/R2 privado mantendo a mesma interface (ver docs/DEPLOY.md).
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

export async function saveOriginal(orgId: string, data: Uint8Array): Promise<string> {
  const key = `${orgId}/${randomUUID()}.pdf`;
  const full = path.join(/*turbopackIgnore: true*/ root(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data, { flag: "wx" });
  return key;
}

export async function readOriginal(key: string): Promise<Buffer> {
  if (!KEY_RE.test(key)) throw new Error("Chave de armazenamento inválida");
  const full = path.join(/*turbopackIgnore: true*/ root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("Caminho fora do armazenamento");
  return readFile(full);
}
