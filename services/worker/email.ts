/**
 * Despacho da caixa de saída de e-mail.
 *
 * - RESEND_API_KEY definida → envia pela API do Resend (remetente EMAIL_FROM,
 *   que precisa ser de domínio VERIFICADO no provedor).
 * - EMAIL_TRANSPORT=file → grava .eml em STORAGE_DIR/outbox e marca
 *   "skipped": nada é dado como enviado sem ter sido enviado.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export async function dispatchEmails(sql: Sql, limit = 20): Promise<{ sent: number; skipped: number; failed: number }> {
  const rows = await sql<{ id: string; to_email: string; subject: string; body_text: string; body_html: string; attempts: number }[]>`
    SELECT id, to_email::text AS to_email, subject, body_text, body_html, attempts
    FROM email_outbox WHERE status = 'pending' ORDER BY created_at LIMIT ${limit}
  `;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const m of rows) {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    try {
      if (process.env.EMAIL_TRANSPORT !== "file" && key && from) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [m.to_email], subject: m.subject, html: m.body_html, text: m.body_text }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
        await sql`UPDATE email_outbox SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = ${m.id}`;
        sent++;
      } else {
        const dir = path.join(path.resolve(process.env.STORAGE_DIR ?? "./storage"), "outbox");
        await mkdir(dir, { recursive: true });
        await writeFile(
          path.join(dir, `${m.id}.eml`),
          `To: ${m.to_email}\nSubject: ${m.subject}\nContent-Type: text/plain; charset=utf-8\n\n${m.body_text}\n`,
        );
        await sql`
          UPDATE email_outbox SET status = 'skipped', attempts = attempts + 1,
                 last_error = 'Provedor de e-mail não configurado: mensagem gravada em arquivo (desenvolvimento).'
          WHERE id = ${m.id}`;
        skipped++;
      }
    } catch (e) {
      const final = m.attempts + 1 >= 5;
      await sql`
        UPDATE email_outbox SET attempts = attempts + 1, last_error = ${(e as Error).message.slice(0, 500)},
               status = ${final ? "failed" : "pending"}
        WHERE id = ${m.id}`;
      failed++;
    }
  }
  return { sent, skipped, failed };
}
