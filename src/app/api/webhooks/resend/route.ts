import { workerPool } from "@/lib/db/client";
import { verifyWebhookSignature, type ResendWebhookEvent } from "@/lib/email/webhook";
import { applyProviderEvent } from "../../../../../services/worker/email";

export const dynamic = "force-dynamic";

/** Eventos de entrega do Resend. Assinatura obrigatória; processamento idempotente. */
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return new Response("not configured", { status: 404 });
  const body = await request.text();
  if (body.length > 64_000) return new Response("too large", { status: 413 });
  const ok = verifyWebhookSignature(secret, {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  }, body);
  if (!ok) return new Response("invalid signature", { status: 401 });

  let event: ResendWebhookEvent;
  try { event = JSON.parse(body) as ResendWebhookEvent; } catch { return new Response("invalid body", { status: 400 }); }
  const messageId = event.data?.email_id;
  if (!event.type || !messageId) return Response.json({ ok: true, ignored: true });
  const detail = event.data?.bounce?.message ?? event.data?.reason;
  const applied = await applyProviderEvent(workerPool(), {
    eventId: request.headers.get("svix-id")!,
    type: event.type,
    messageId,
    occurredAt: event.created_at ? new Date(event.created_at) : undefined,
    detail: detail ? String(detail) : undefined,
  });
  console.info(JSON.stringify({ event: "email_webhook", type: event.type, applied }));
  return Response.json({ ok: true, applied });
}
