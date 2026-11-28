import { withBootstrap } from "@/lib/db/client";
import type { Role } from "@/lib/authz/policy";

/**
 * Sessão de tenant verificada (herdado da versão anterior do produto — correções BUG-01/02).
 *
 * Só objetos devolvidos por `resolveSession` passam em `isSession`: a
 * identidade do objeto é registrada num WeakSet privado. Spread, clone,
 * Object.assign e JSON.parse produzem objetos novos, que não estão no
 * registro. Org, usuário e papel viajam juntos.
 */
declare const SESSION_BRAND: unique symbol;

export type Session = {
  readonly orgId: string;
  readonly userId: string;
  readonly role: Role;
  readonly status: "active";
  readonly [SESSION_BRAND]: true;
};

const VERIFIED = new WeakSet<object>();

export function isSession(value: unknown): value is Session {
  return typeof value === "object" && value !== null && VERIFIED.has(value);
}

export class InvalidSessionError extends Error {
  constructor() {
    super("Sessão não verificada: contexto de tenant precisa vir de resolveSession");
    this.name = "InvalidSessionError";
  }
}

/** ÚNICO produtor de Session. Consulta o vínculo real no banco. */
export async function resolveSession(userId: string, orgId: string): Promise<Session | null> {
  const rows = await withBootstrap("resolução de sessão", (db) =>
    db<{ role: Role; status: "active" | "disabled"; org_status: string }[]>`
      SELECT m.role, m.status, o.status AS org_status
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = ${userId}
        AND m.org_id = ${orgId}
        AND u.deleted_at IS NULL
        AND o.deleted_at IS NULL
    `,
  );

  const row = rows[0];
  if (!row || row.status !== "active") return null;
  // Corretora suspensa ou cancelada não opera.
  if (row.org_status === "suspended" || row.org_status === "cancelled") return null;

  const session = Object.freeze({
    orgId,
    userId,
    role: row.role,
    status: "active" as const,
  }) as unknown as Session;

  VERIFIED.add(session);
  return session;
}
