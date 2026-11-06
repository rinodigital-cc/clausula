import { send } from "@vercel/queue";

/** Durable DB jobs remain the source of truth; the queue only wakes the processor. */
export async function notifyProcessor(strict = false): Promise<void> {
  if (process.env.PROCESSING_DRIVER !== "vercel") {
    if (strict) throw new Error("Processamento por fila ainda não configurado.");
    return;
  }
  try {
    await send("apoia-processing", { kind: "wake" }, { retentionSeconds: 86400 });
  } catch {
    // Upload/invite was committed. Never tell the user it failed and invite duplication.
    console.error(JSON.stringify({ event: "processing_notification_failed", recovery: "admin_retry" }));
    if (strict) throw new Error("Não foi possível acionar a fila. Tente novamente.");
  }
}
