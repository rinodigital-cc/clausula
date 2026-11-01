import "server-only";
import { withBootstrap } from "@/lib/db/client";
import { hashPassword, hashToken, newToken, passwordProblem } from "@/lib/auth/password";
import { appUrl, enqueueEmail, passwordResetEmail } from "@/lib/email/outbox";

const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Pedido de redefinição. Resposta idêntica exista ou não o e-mail: a tela
 * não serve para descobrir quem tem conta.
 */
export async function requestPasswordReset(emailRaw: string): Promise<void> {
  const email = (emailRaw ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  const token = newToken();
  await withBootstrap("pedido de redefinição de senha", (db) =>
    db.begin(async (tx) => {
      const [user] = await tx<{ id: string }[]>`SELECT id FROM users WHERE email = ${email} AND deleted_at IS NULL`;
      if (!user) return;
      const [recent] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM password_resets
        WHERE user_id = ${user.id} AND created_at > now() - interval '1 hour'
      `;
      if ((recent?.n ?? 0) >= 3) return; // limite silencioso
      await tx`
        INSERT INTO password_resets (user_id, token_hash, purpose, expires_at)
        VALUES (${user.id}, ${hashToken(token)}, 'reset', ${new Date(Date.now() + RESET_TTL_MS)})
      `;
      await enqueueEmail(tx as never, passwordResetEmail({ to: email, link: appUrl(`/redefinir/${token}`), firstAccess: false }));
    }),
  );
}

export async function checkResetToken(token: string): Promise<boolean> {
  if (!token || token.length > 120) return false;
  const [row] = await withBootstrap("verificação de link de senha", (db) =>
    db`SELECT 1 FROM password_resets WHERE token_hash = ${hashToken(token)} AND used_at IS NULL AND expires_at > now()`,
  );
  return !!row;
}

/** Troca a senha, consome o link e derruba TODAS as sessões da pessoa. */
export async function resetPassword(token: string, password: string): Promise<{ userId: string }> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const passwordHash = await hashPassword(password);
  return withBootstrap("redefinição de senha", (db) =>
    db.begin(async (tx) => {
      const [row] = await tx<{ id: string; user_id: string }[]>`
        SELECT id, user_id FROM password_resets
        WHERE token_hash = ${hashToken(token)} AND used_at IS NULL AND expires_at > now()
        FOR UPDATE
      `;
      if (!row) throw new Error("Link inválido ou expirado. Peça um novo.");
      await tx`UPDATE users SET password_hash = ${passwordHash}, email_verified_at = coalesce(email_verified_at, now()) WHERE id = ${row.user_id}`;
      await tx`UPDATE password_resets SET used_at = now() WHERE id = ${row.id}`;
      await tx`UPDATE sessions SET revoked_at = now() WHERE user_id = ${row.user_id} AND revoked_at IS NULL`;
      return { userId: row.user_id };
    }),
  ) as Promise<{ userId: string }>;
}
