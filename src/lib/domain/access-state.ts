/** Estado operacional do acesso do responsável (módulo puro, testável). */
export type AccessInput = {
  ownerEmail: string | null;
  ownerPending: string | null;
  inviteExpiresAt: Date | null;
  emailStatus: string | null;
  deliveryStatus: string | null;
};

export type AccessState = "active" | "awaiting_send" | "not_sent" | "sent" | "delivered" | "expired" | "failed" | "no_invite";

export const ACCESS_STATE_LABEL: Record<AccessState, string> = {
  active: "Conta ativa",
  awaiting_send: "Aguardando envio",
  not_sent: "Não enviado · sem provedor",
  sent: "Enviado · aguardando ativação",
  delivered: "Entregue · aguardando ativação",
  expired: "Convite expirado",
  failed: "Falha no envio",
  no_invite: "Sem convite",
};

/** Estado operacional do acesso do responsável. "Enviado" ≠ "Entregue". */
export function accessState(b: AccessInput, now = Date.now()): AccessState {
  if (b.ownerEmail) return "active";
  if (!b.ownerPending) return "no_invite";
  if (b.inviteExpiresAt && b.inviteExpiresAt.getTime() <= now) return "expired";
  if (b.emailStatus === "failed" || ["bounced", "complained", "failed", "suppressed"].includes(b.deliveryStatus ?? "")) return "failed";
  if (b.deliveryStatus === "delivered") return "delivered";
  if (b.emailStatus === "sent") return "sent";
  if (b.emailStatus === "skipped") return "not_sent";
  return "awaiting_send";
}
