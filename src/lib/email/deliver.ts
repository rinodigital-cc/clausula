import "server-only";
import { workerPool } from "@/lib/db/client";
import { notifyProcessor } from "@/lib/processing";
import { dispatchEmails, emailProviderConfigured } from "../../../services/worker/email";

export type DeliveryAttempt = {
  /** true = aceito pelo provedor agora (ainda NÃO significa entregue). */
  accepted: boolean;
  /** Provedor configurado neste ambiente. */
  provider: boolean;
};

/**
 * Despacha AGORA as mensagens recém-gravadas (após o commit da transação que
 * as criou). Não depende da fila: se algo falhar, a mensagem continua
 * pendente e a fila/worker tentam de novo. Nunca lança erro para quem chama.
 */
export async function deliverNow(ids: string[]): Promise<DeliveryAttempt> {
  const provider = emailProviderConfigured();
  if (!ids.length) return { accepted: false, provider };
  let accepted = false;
  try {
    const r = await dispatchEmails(workerPool(), ids.length, ids, 8_000);
    accepted = r.sent === ids.length;
  } catch {
    console.error(JSON.stringify({ event: "email_immediate_dispatch_failed", count: ids.length }));
  }
  if (!accepted) {
    try { await notifyProcessor(); } catch { /* registrado em notifyProcessor */ }
  }
  return { accepted, provider };
}
