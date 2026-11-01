import "server-only";
import { withTenant, withBootstrap, type PrivilegedSql } from "@/lib/db/client";
import type { Session } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { authorize, canRemoveMember, ROLE_LABEL, ROLES, type Role } from "@/lib/authz/policy";
import { hashPassword, hashToken, newToken, passwordProblem } from "@/lib/auth/password";
import { appUrl, enqueueEmail, invitationEmail } from "@/lib/email/outbox";

/**
 * Equipe e convites (herdado da versão anterior do produto, Milestone 1, com aceite e cadastro).
 * Token em claro só existe no retorno da emissão; o banco guarda o hash (R-22).
 */
export const INVITE_TTL_DAYS = 7;

function assertAssignableRole(role: unknown): asserts role is "admin" | "member" {
  if (role !== "admin" && role !== "member") {
    const known = ROLES.includes(role as Role);
    throw new Error(known ? "O papel de proprietário não pode ser atribuído por convite interno." : "Papel inválido.");
  }
}

export type Member = {
  userId: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "disabled";
  lastSeenAt: Date | null;
  joinedAt: Date;
};

export type PendingInvite = { id: string; email: string; role: Role; expiresAt: Date; createdAt: Date; expired: boolean };

export async function inviteMember(
  session: Session,
  input: { email: string; role: string },
): Promise<{ inviteId: string; link: string }> {
  authorize(session, "member.manage");
  assertAssignableRole(input.role);
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("E-mail inválido.");

  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 864e5);

  return withTenant(session, async (tx) => {
    const [ok] = await tx<{ ok: boolean }[]>`SELECT consume_rate_limit('member.invite', 20, interval '1 hour') AS ok`;
    if (!ok?.ok) throw new Error("Limite de convites por hora atingido. Tente mais tarde.");

    const [already] = await tx`
      SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = (SELECT current_org()) AND u.email = ${email} AND m.status = 'active' LIMIT 1
    `;
    if (already) throw new Error("Essa pessoa já faz parte da corretora.");

    const [row] = await tx<{ id: string }[]>`
      INSERT INTO invitations (org_id, email, role, token_hash, invited_by, expires_at)
      VALUES ((SELECT current_org()), ${email}, ${input.role}, ${hashToken(token)}, ${session.userId}, ${expiresAt})
      ON CONFLICT (org_id, email) WHERE accepted_at IS NULL
      DO UPDATE SET token_hash = EXCLUDED.token_hash, role = EXCLUDED.role, expires_at = EXCLUDED.expires_at,
                    invited_by = EXCLUDED.invited_by
      RETURNING id
    `;
    if (!row) throw new Error("Falha ao criar convite.");

    const [ctx] = await tx<{ org_name: string; inviter: string }[]>`
      SELECT o.name AS org_name, u.name AS inviter
      FROM organizations o, users u
      WHERE o.id = (SELECT current_org()) AND u.id = ${session.userId}
    `;
    const link = appUrl(`/convite/${token}`);
    await enqueueEmail(
      tx,
      invitationEmail({
        orgId: session.orgId,
        to: email,
        orgName: ctx?.org_name ?? "sua corretora",
        inviterName: ctx?.inviter ?? "A administração",
        roleLabel: ROLE_LABEL[input.role as keyof typeof ROLE_LABEL] ?? input.role,
        link,
        expiresDays: INVITE_TTL_DAYS,
      }),
    );
    await recordAudit(tx, {
      actorId: session.userId,
      action: "member.invited",
      entityType: "invitation",
      entityId: row.id,
      metadata: { email, role: input.role },
    });
    return { inviteId: row.id, link };
  });
}

export type InvitationPreview =
  | { state: "invalid" }
  | { state: "expired"; orgName: string }
  | { state: "accepted"; orgName: string }
  | { state: "valid"; orgName: string; email: string; role: Role; userExists: boolean; expiresAt: Date };

export async function previewInvitation(token: string): Promise<InvitationPreview> {
  if (!token || token.length > 120) return { state: "invalid" };
  const [row] = await withBootstrap("pré-visualização de convite", (db) =>
    db<{ org_name: string; email: string; role: Role; expires_at: Date; accepted_at: Date | null; user_exists: boolean }[]>`
      SELECT o.name AS org_name, i.email::text AS email, i.role, i.expires_at, i.accepted_at,
             EXISTS (SELECT 1 FROM users u WHERE u.email = i.email AND u.deleted_at IS NULL) AS user_exists
      FROM invitations i JOIN organizations o ON o.id = i.org_id
      WHERE i.token_hash = ${hashToken(token)}
    `,
  );
  if (!row) return { state: "invalid" };
  if (row.accepted_at) return { state: "accepted", orgName: row.org_name };
  if (row.expires_at.getTime() <= Date.now()) return { state: "expired", orgName: row.org_name };
  return {
    state: "valid",
    orgName: row.org_name,
    email: row.email,
    role: row.role,
    userExists: row.user_exists,
    expiresAt: row.expires_at,
  };
}

async function acceptInTx(tx: PrivilegedSql, token: string, userId: string): Promise<{ orgId: string; role: Role }> {
  const [invite] = await tx<{ id: string; org_id: string; role: Role; email: string }[]>`
    SELECT id, org_id, role, email::text AS email FROM invitations
    WHERE token_hash = ${hashToken(token)} AND accepted_at IS NULL AND expires_at > now()
    FOR UPDATE
  `;
  if (!invite) throw new Error("Convite inválido ou expirado.");
  const [user] = await tx<{ email: string }[]>`SELECT email::text AS email FROM users WHERE id = ${userId}`;
  if (!user) throw new Error("Usuário não encontrado.");
  // Convite é para um e-mail específico: token vazado não serve a outra conta.
  if (user.email.toLowerCase() !== invite.email.toLowerCase()) throw new Error("Este convite foi emitido para outro e-mail.");

  if (invite.role === "owner") {
    const [owner] = await tx`SELECT 1 FROM memberships WHERE org_id = ${invite.org_id} AND role = 'owner' AND status = 'active' AND user_id <> ${userId}`;
    if (owner) throw new Error("Esta corretora já tem proprietário.");
  }
  await tx`
    INSERT INTO memberships (org_id, user_id, role)
    VALUES (${invite.org_id}, ${userId}, ${invite.role})
    ON CONFLICT (org_id, user_id) DO UPDATE SET status = 'active', role = EXCLUDED.role
  `;
  await tx`UPDATE invitations SET accepted_at = now() WHERE id = ${invite.id}`;
  await tx`
    INSERT INTO audit_logs (org_id, actor_id, action, entity_type, entity_id)
    VALUES (${invite.org_id}, ${userId}, 'member.joined', 'membership', ${invite.id})
  `;
  return { orgId: invite.org_id, role: invite.role };
}

/** Aceite por quem JÁ tem conta e está logado com o mesmo e-mail. */
export async function acceptInvitation(token: string, userId: string): Promise<{ orgId: string; role: Role }> {
  return withBootstrap("aceite de convite: usuário ainda não é membro", (db) =>
    db.begin((tx) => acceptInTx(tx as unknown as PrivilegedSql, token, userId)),
  ) as Promise<{ orgId: string; role: Role }>;
}

/** Primeiro acesso: cria a conta (nome + senha) e aceita o convite na mesma transação. */
export async function registerAndAccept(input: {
  token: string;
  name: string;
  password: string;
}): Promise<{ userId: string; orgId: string }> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw new Error("Informe seu nome completo.");
  const problem = passwordProblem(input.password);
  if (problem) throw new Error(problem);
  const passwordHash = await hashPassword(input.password);

  return withBootstrap("primeiro acesso por convite", (db) =>
    db.begin(async (tx) => {
      const [invite] = await tx<{ email: string }[]>`
        SELECT email::text AS email FROM invitations
        WHERE token_hash = ${hashToken(input.token)} AND accepted_at IS NULL AND expires_at > now()
      `;
      if (!invite) throw new Error("Convite inválido ou expirado.");
      const [existing] = await tx`SELECT 1 FROM users WHERE email = ${invite.email} AND deleted_at IS NULL`;
      if (existing) throw new Error("Já existe uma conta com este e-mail. Entre com sua senha para aceitar o convite.");
      const [user] = await tx<{ id: string }[]>`
        INSERT INTO users (email, name, password_hash, email_verified_at)
        VALUES (${invite.email}, ${name}, ${passwordHash}, now())
        RETURNING id
      `;
      const { orgId } = await acceptInTx(tx as unknown as PrivilegedSql, input.token, user!.id);
      return { userId: user!.id, orgId };
    }),
  ) as Promise<{ userId: string; orgId: string }>;
}

export async function listMembers(session: Session): Promise<Member[]> {
  authorize(session, "member.read");
  return withTenant(session, (tx) =>
    tx<Member[]>`
      SELECT m.user_id AS "userId", u.name, u.email::text AS email, m.role, m.status,
             u.last_seen_at AS "lastSeenAt", m.joined_at AS "joinedAt"
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = (SELECT current_org())
      ORDER BY (m.status = 'active') DESC, (m.role = 'owner') DESC, u.name
    `,
  );
}

export async function listPendingInvites(session: Session): Promise<PendingInvite[]> {
  authorize(session, "member.read");
  return withTenant(session, (tx) =>
    tx<PendingInvite[]>`
      SELECT id, email::text AS email, role, expires_at AS "expiresAt", created_at AS "createdAt",
             (expires_at <= now()) AS expired
      FROM invitations
      WHERE org_id = (SELECT current_org()) AND accepted_at IS NULL
      ORDER BY created_at DESC
    `,
  );
}

export async function revokeInvite(session: Session, inviteId: string): Promise<void> {
  authorize(session, "member.manage");
  await withTenant(session, async (tx) => {
    const r = await tx`
      UPDATE invitations SET expires_at = now()
      WHERE id = ${inviteId} AND org_id = (SELECT current_org()) AND accepted_at IS NULL
    `;
    if (r.count === 0) throw new Error("Convite não encontrado.");
    await recordAudit(tx, { actorId: session.userId, action: "invitation.revoked", entityType: "invitation", entityId: inviteId });
  });
}

export async function changeMemberRole(session: Session, input: { userId: string; role: string }): Promise<void> {
  authorize(session, "member.manage");
  assertAssignableRole(input.role);
  if (input.userId === session.userId) throw new Error("Não é possível alterar o próprio papel.");
  await withTenant(session, async (tx) => {
    const [target] = await tx<{ role: Role }[]>`
      SELECT role FROM memberships WHERE org_id = (SELECT current_org()) AND user_id = ${input.userId}
    `;
    if (!target) throw new Error("Membro não encontrado.");
    if (target.role === "owner") throw new Error("Transfira a titularidade antes de rebaixar o proprietário.");
    await tx`UPDATE memberships SET role = ${input.role} WHERE org_id = (SELECT current_org()) AND user_id = ${input.userId}`;
    await recordAudit(tx, {
      actorId: session.userId,
      action: "member.role_changed",
      entityType: "membership",
      metadata: { targetUserId: input.userId, from: target.role, to: input.role },
    });
  });
}

/** Remoção revoga as sessões na hora (R-17). */
export async function removeMember(session: Session, targetUserId: string): Promise<void> {
  const [target] = await withTenant(session, (tx) =>
    tx<{ role: Role }[]>`SELECT role FROM memberships WHERE org_id = (SELECT current_org()) AND user_id = ${targetUserId}`,
  );
  if (!target) throw new Error("Membro não encontrado.");
  const verdict = canRemoveMember(session, { userId: targetUserId, role: target.role });
  if (!verdict.allowed) throw new Error(verdict.reason ?? "Remoção não permitida.");

  await withTenant(session, async (tx) => {
    await tx`UPDATE memberships SET status = 'disabled' WHERE org_id = (SELECT current_org()) AND user_id = ${targetUserId}`;
    await recordAudit(tx, { actorId: session.userId, action: "member.removed", entityType: "membership", metadata: { targetUserId } });
  });
  await withBootstrap("revogação de sessão após remoção de membro", (db) =>
    db`
      UPDATE sessions SET revoked_at = now()
      WHERE user_id = ${targetUserId} AND active_org_id = ${session.orgId} AND revoked_at IS NULL
    `,
  );
}
