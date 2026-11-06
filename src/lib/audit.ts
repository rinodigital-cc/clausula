import type { TenantSql } from "@/lib/db/client";

/**
 * Auditoria na MESMA transação do fato de negócio (herdado da versão anterior do produto).
 * O banco impede UPDATE e DELETE para os papéis de runtime.
 */
export type AuditAction =
  | "organization.created"
  | "organization.updated"
  | "member.invited"
  | "member.joined"
  | "member.role_changed"
  | "member.removed"
  | "invitation.revoked"
  | "session.created"
  | "session.revoked"
  | "catalog.insurer_created"
  | "catalog.product_created"
  | "document.uploaded"
  | "document.reprocessed"
  | "document.deactivated"
  | "document.activated"
  | "document.opened"
  | "gap.resolved"
  | "gap.dismissed"
  | "note.created";

export type AuditEntry = {
  actorId: string | null;
  actorType?: "user" | "system" | "api_key";
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function recordAudit(tx: TenantSql, entry: AuditEntry): Promise<void> {
  await tx`
    INSERT INTO audit_logs (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
    VALUES (
      (SELECT current_org()),
      ${entry.actorId},
      ${entry.actorType ?? "user"},
      ${entry.action},
      ${entry.entityType},
      ${entry.entityId ?? null},
      ${JSON.stringify(entry.metadata ?? {})}::jsonb
    )
  `;
}
