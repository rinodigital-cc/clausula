import { handleCallback } from "@vercel/queue";
import { workerPool } from "@/lib/db/client";
import { processOneJob } from "../../../../../services/worker/ingest";
import { dispatchEmails } from "../../../../../services/worker/email";

export const maxDuration = 300;

// SDK verifies queue delivery. Never expose an unauthenticated drain endpoint.
export const POST = handleCallback(async (message: { kind: string }) => {
  if (message.kind !== "wake") throw new Error("Mensagem de processamento inválida");
  if (process.env.PROCESSING_DRIVER !== "vercel") throw new Error("Processamento não habilitado");
  const sql = workerPool();
  const result = await processOneJob(sql);
  const emails = await dispatchEmails(sql, 5);
  console.info(JSON.stringify({ event: "processing_batch", status: result?.status ?? "empty", emails }));
  if (result?.status === "retry" || emails.failed) throw new Error("Nova tentativa necessária");
}, {
  // Existing DB lease expires after 10 minutes: retry after expiry if execution dies.
  retry: (_error, metadata) => metadata.deliveryCount >= 5 ? { acknowledge: true } : { afterSeconds: 650 },
});
