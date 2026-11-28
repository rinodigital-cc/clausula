/**
 * Despacho da caixa de saída de e-mail — ÚNICO caminho de envio da plataforma.
 *
 * - RESEND_API_KEY + EMAIL_FROM → envia pela API do Resend (remetente de
 *   domínio VERIFICADO). "sent" significa ACEITO pelo provedor; a entrega
 *   só é registrada quando o provedor informar "delivered" (webhook ou
 *   consulta em syncDeliveryStatus).
 * - EMAIL_TRANSPORT=file (somente desenvolvimento) → grava .eml e marca
 *   "skipped": nada é dado como enviado sem ter sido enviado.
 * - Na Vercel sem provedor, as mensagens ficam pendentes (nunca descartadas).
 *
 * Logs nunca incluem corpo, link, chave ou endereço completo.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type postgres from "postgres";
import type { SqlClient } from "../../src/lib/db/client";

type SqlInput = SqlClient | ReturnType<typeof postgres>;
type Result = { sent: number; skipped: number; failed: number; deferred: number };

const RESEND_API = "https://api.resend.com";
const MAX_ATTEMPTS = 5;

export function emailProviderConfigured(): boolean {
  return process.env.EMAIL_TRANSPORT !== "file" && !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

export function dailyCap(): number {
  const n = Number(process.env.EMAIL_DAILY_CAP ?? 90);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 90;
}

/** Erros que não melhoram com nova tentativa (remetente/domínio/destinatário inválido). */
export function isPermanentStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 422;
}

/** Espera exponencial: 1, 2, 4, 8 min… (máx. 60). */
export function backoffMinutes(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts));
}

async function providerError(res: Response): Promise<string> {
  const data = await res.json().catch(() => null) as { name?: string; message?: string } | null;
  const detail = [data?.name, data?.message].filter(Boolean).join(": ").replace(/re_[A-Za-z0-9_]+/g, "re_***");
  return `Resend ${res.status}${detail ? ` — ${detail}` : ""}`.slice(0, 300);
}

/**
 * @param timeoutMs  caminho imediato (usuário esperando) usa tempo menor; a
 *                   fila/worker usa o padrão. Timeout não perde a mensagem:
 *                   ela volta para a fila e a Idempotency-Key evita duplicar.
 */
export async function dispatchEmails(sqlInput: SqlInput, limit = 20, onlyIds?: string[], timeoutMs = 15_000): Promise<Result> {
  const sql = sqlInput as unknown as SqlClient;
  const result: Result = { sent: 0, skipped: 0, failed: 0, deferred: 0 };
  const provider = emailProviderConfigured();
  // Ambiente remoto sem provedor: mantém pendente até o provedor ser configurado.
  if (process.env.VERCEL && !provider) return result;

  const rows = onlyIds?.length
    ? await sql<{ id: string; to_email: string; subject: string; body_text: string; body_html: string; attempts: number }[]>`
        SELECT id, to_email::text AS to_email, subject, body_text, body_html, attempts
        FROM email_outbox WHERE status = 'pending' AND id = ANY(${onlyIds}::uuid[]) ORDER BY created_at LIMIT ${limit}`
    : await sql<{ id: string; to_email: string; subject: string; body_text: string; body_html: string; attempts: number }[]>`
        SELECT id, to_email::text AS to_email, subject, body_text, body_html, attempts
        FROM email_outbox
        WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY created_at LIMIT ${limit}`;
  if (!rows.length) return result;

  let budget = Infinity;
  if (provider) {
    const [used] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM email_outbox WHERE sent_at > now() - interval '24 hours'`;
    budget = dailyCap() - (used?.n ?? 0);
  }

  for (const m of rows) {
    try {
      if (provider) {
        if (budget <= 0) {
          await sql`
            UPDATE email_outbox SET next_attempt_at = now() + interval '1 hour',
                   last_error = 'Limite diário de envios da plataforma atingido; nova tentativa automática.'
            WHERE id = ${m.id} AND status = 'pending'`;
          result.deferred++;
          continue;
        }
        const res = await fetch(`${RESEND_API}/emails`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `apoia-email-${m.id}`,
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM,
            to: [m.to_email],
            subject: m.subject,
            html: m.body_html,
            text: m.body_text,
            ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
            tags: [{ name: "outbox_id", value: m.id.replace(/[^A-Za-z0-9_-]/g, "") }],
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          const message = await providerError(res);
          const permanent = isPermanentStatus(res.status);
          const final = permanent || m.attempts + 1 >= MAX_ATTEMPTS;
          await sql`
            UPDATE email_outbox SET attempts = attempts + 1, last_error = ${message},
                   status = ${final ? "failed" : "pending"}, delivery_status = ${final ? "failed" : null}::text,
                   next_attempt_at = ${final ? null : new Date(Date.now() + backoffMinutes(m.attempts) * 60_000)}::timestamptz
            WHERE id = ${m.id}`;
          console.error(JSON.stringify({ event: "email_dispatch_failed", outbox: m.id, status: res.status, permanent }));
          result.failed++;
          continue;
        }
        const data = await res.json().catch(() => null) as { id?: string } | null;
        await sql`
          UPDATE email_outbox SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL,
                 provider = 'resend', provider_message_id = ${data?.id ?? null},
                 delivery_status = 'accepted', last_event_at = now(), next_attempt_at = NULL
          WHERE id = ${m.id}`;
        budget--;
        console.info(JSON.stringify({ event: "email_accepted", outbox: m.id, provider_id: data?.id ?? null }));
        result.sent++;
      } else {
        const dir = path.join(path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR ?? "./storage"), "outbox");
        await mkdir(dir, { recursive: true });
        await writeFile(
          path.join(dir, `${m.id}.eml`),
          `To: ${m.to_email}\nSubject: ${m.subject}\nContent-Type: text/plain; charset=utf-8\n\n${m.body_text}\n`,
        );
        await sql`
          UPDATE email_outbox SET status = 'skipped', attempts = attempts + 1,
                 last_error = 'Provedor de e-mail não configurado: mensagem gravada em arquivo (desenvolvimento).'
          WHERE id = ${m.id}`;
        result.skipped++;
      }
    } catch (e) {
      const final = m.attempts + 1 >= MAX_ATTEMPTS;
      await sql`
        UPDATE email_outbox SET attempts = attempts + 1, last_error = ${(e as Error).message.slice(0, 300)},
               status = ${final ? "failed" : "pending"},
               next_attempt_at = ${final ? null : new Date(Date.now() + backoffMinutes(m.attempts) * 60_000)}::timestamptz
        WHERE id = ${m.id}`;
      result.failed++;
    }
  }
  return result;
}

// ----------------------------------------------------------------- entrega

export type DeliveryStatus = "accepted" | "delivered" | "delivery_delayed" | "bounced" | "complained" | "failed" | "suppressed";

const RANK: Record<DeliveryStatus, number> = {
  accepted: 1, delivery_delayed: 2, delivered: 3, bounced: 4, complained: 4, failed: 4, suppressed: 4,
};

/** Converte tipo de evento do Resend ("email.delivered" ou "delivered") no estado interno. */
export function mapProviderEvent(type: string): DeliveryStatus | null {
  const t = type.replace(/^email\./, "");
  if (t === "sent") return "accepted";
  return t in RANK ? (t as DeliveryStatus) : null;
}

/** Estado nunca regride (ex.: "atrasado" depois de "entregue" é ignorado). */
export function shouldAdvance(current: string | null, next: DeliveryStatus): boolean {
  const c = current && current in RANK ? RANK[current as DeliveryStatus] : 0;
  return RANK[next] >= c;
}

/**
 * Aplica um evento do provedor de forma idempotente. Retorna false se o
 * evento já tinha sido processado ou a mensagem não é desta plataforma.
 */
export async function applyProviderEvent(
  sqlInput: SqlInput,
  ev: { eventId: string; type: string; messageId: string; occurredAt?: Date; detail?: string },
): Promise<boolean> {
  const sql = sqlInput as unknown as SqlClient;
  const status = mapProviderEvent(ev.type);
  const [msg] = await sql<{ id: string; delivery_status: string | null }[]>`
    SELECT id, delivery_status FROM email_outbox WHERE provider_message_id = ${ev.messageId}`;
  if (!msg) return false;
  const inserted = await sql`
    INSERT INTO email_events (provider_event_id, outbox_id, type, occurred_at, detail)
    VALUES (${ev.eventId.slice(0, 200)}, ${msg.id}, ${ev.type.slice(0, 60)}, ${ev.occurredAt ?? null}::timestamptz, ${ev.detail?.slice(0, 300) ?? null})
    ON CONFLICT (provider_event_id) DO NOTHING
    RETURNING id`;
  if (!inserted.length) return false;
  if (status && shouldAdvance(msg.delivery_status, status)) {
    await sql`
      UPDATE email_outbox SET delivery_status = ${status}, last_event_at = now(),
             delivered_at = CASE WHEN ${status}::text = 'delivered' THEN coalesce(delivered_at, ${ev.occurredAt ?? new Date()}::timestamptz) ELSE delivered_at END,
             last_error = CASE WHEN ${status}::text IN ('bounced','complained','failed','suppressed') THEN ${ev.detail?.slice(0, 300) ?? "Entrega recusada pelo servidor de destino."}::text ELSE last_error END
      WHERE id = ${msg.id}`;
  }
  return true;
}

/**
 * Consulta ao provedor o último evento das mensagens aceitas e ainda sem
 * estado final (dispensa webhook). Lotes de 4 em paralelo com pausa curta:
 * fica abaixo do limite de 10 req/s do Resend e não prende a tela do painel.
 */
export async function syncDeliveryStatus(sqlInput: SqlInput, limit = 10): Promise<{ checked: number; updated: number }> {
  const sql = sqlInput as unknown as SqlClient;
  const out = { checked: 0, updated: 0 };
  if (!emailProviderConfigured()) return out;
  const rows = await sql<{ provider_message_id: string }[]>`
    SELECT provider_message_id FROM email_outbox
    WHERE provider = 'resend' AND provider_message_id IS NOT NULL
      AND delivery_status IN ('accepted','delivery_delayed') AND sent_at > now() - interval '7 days'
    ORDER BY sent_at DESC LIMIT ${limit}`;
  const checkOne = async (r: { provider_message_id: string }) => {
    try {
      const res = await fetch(`${RESEND_API}/emails/${encodeURIComponent(r.provider_message_id)}`, {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => null) as { last_event?: string } | null;
      const last = data?.last_event;
      if (last && mapProviderEvent(last) && mapProviderEvent(last) !== "accepted") {
        if (await applyProviderEvent(sql, { eventId: `poll:${r.provider_message_id}:${last}`, type: last, messageId: r.provider_message_id })) out.updated++;
      }
    } catch { /* tenta de novo na próxima sincronização */ }
  };
  for (let i = 0; i < rows.length; i += 4) {
    const batch = rows.slice(i, i + 4);
    out.checked += batch.length;
    await Promise.all(batch.map(checkOne));
    if (i + 4 < rows.length) await new Promise((ok) => setTimeout(ok, 450));
  }
  return out;
}
