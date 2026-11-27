import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verificação de assinatura de webhook do Resend (formato Svix):
 * conteúdo assinado = `${svix-id}.${svix-timestamp}.${corpo bruto}`,
 * HMAC-SHA256 com o segredo `whsec_<base64>`; cabeçalho `svix-signature`
 * traz uma ou mais assinaturas "v1,<base64>". Tolerância de 5 minutos.
 */
export function verifyWebhookSignature(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > 300) return false;
  let key: Buffer;
  try { key = Buffer.from(secret.replace(/^whsec_/, ""), "base64"); } catch { return false; }
  if (!key.length) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    let given: Buffer;
    try { given = Buffer.from(value, "base64"); } catch { return false; }
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export type ResendWebhookEvent = { type?: string; created_at?: string; data?: { email_id?: string; bounce?: { message?: string }; reason?: string } };
