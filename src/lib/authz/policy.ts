/**
 * Autorização (RBAC) — herdado da versão anterior do produto, ampliado para a ApoIA Seguro.
 *
 * Camadas de defesa, da mais fraca para a mais forte:
 *   1. Interface esconde o que o usuário não pode fazer  → ergonomia
 *   2. Este módulo, no servidor                          → autorização
 *   3. RLS no banco                                      → isolamento
 *   4. FK composta (org_id, id)                          → integridade
 *
 * Papéis na interface:
 *   owner  → "Proprietário"  (administrador da corretora, titular)
 *   admin  → "Administrador" (administrador da corretora)
 *   member → "Corretor"
 * O administrador da PLATAFORMA não é papel de corretora: é a tabela
 * platform_admins, verificada à parte (ver lib/auth/web.ts).
 */
import { isSession, type Session } from "@/lib/auth/session";

export const ROLES = ["owner", "admin", "member"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  member: "Corretor",
};

export const ACTIONS = [
  "specialist.query",
  "conversation.read.own",
  "conversation.read.org",
  "library.browse",
  "source.read",
  "source.write",
  "note.write",
  "catalog.manage",
  "specialist.configure",
  "specialist.publish",
  "member.read",
  "member.manage",
  "analytics.read",
  "gap.manage",
  "billing.manage",
  "organization.delete",
] as const;
export type Action = (typeof ACTIONS)[number];

const MEMBER: Action[] = ["specialist.query", "conversation.read.own", "library.browse"];
const ADMIN: Action[] = [
  ...MEMBER,
  "conversation.read.org",
  "source.read",
  "source.write",
  "note.write",
  "catalog.manage",
  "specialist.configure",
  "specialist.publish",
  "member.read",
  "member.manage",
  "analytics.read",
  "gap.manage",
];

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  member: new Set(MEMBER),
  admin: new Set(ADMIN),
  owner: new Set(ACTIONS),
};

export type Actor = Session;

/** Negação por padrão. */
export function can(actor: Actor, action: Action): boolean {
  if (!isSession(actor)) return false;
  if (actor.status !== "active") return false;
  return MATRIX[actor.role].has(action);
}

export class ForbiddenError extends Error {
  constructor(public readonly action: Action) {
    super("Você não tem permissão para fazer isso.");
    this.name = "ForbiddenError";
  }
}

export function authorize(actor: Actor, action: Action): void {
  if (!can(actor, action)) throw new ForbiddenError(action);
}

export function isOrgAdmin(actor: Actor): boolean {
  return can(actor, "member.manage");
}

export function canRemoveMember(
  actor: Actor,
  target: { userId: string; role: Role },
): { allowed: boolean; reason?: string } {
  if (!can(actor, "member.manage")) return { allowed: false, reason: "Sem permissão para gerenciar a equipe" };
  if (target.role === "owner") {
    return { allowed: false, reason: "Transfira a titularidade antes de remover o proprietário" };
  }
  if (target.userId === actor.userId) return { allowed: false, reason: "Não é possível remover a si mesmo" };
  return { allowed: true };
}
