import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { withBootstrap } from "@/lib/db/client";
import { resolveSession, type Session } from "@/lib/auth/session";
import { hashToken, newToken, verifyPassword } from "@/lib/auth/password";
import { can, type Action, type Role } from "@/lib/authz/policy";

/**
 * Sessão web: cookie httpOnly com token aleatório; o banco guarda só o hash.
 * A organização ativa mora na linha da sessão, nunca em parâmetro de URL.
 */
export const SESSION_COOKIE = "apoia_sessao";
const SESSION_DAYS = 14;

function secureCookie(): boolean {
  // Lição da rodada de setembro: cookie Secure sobre HTTP é descartado em
  // silêncio e o login "volta" para a tela de entrar sem erro nenhum.
  return (process.env.APP_URL ?? "").startsWith("https://");
}

export type CurrentUser = {
  sessionId: string;
  userId: string;
  name: string;
  email: string;
  activeOrgId: string | null;
  isPlatformAdmin: boolean;
};

export type Membership = { orgId: string; orgName: string; role: Role; orgStatus: string };

// ---------------------------------------------------------------------------
// Limite de tentativas de login por e-mail (memória do processo).
// Defesa simples contra adivinhação; não substitui limite na borda.
// ---------------------------------------------------------------------------
const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 6;
const WINDOW_MS = 15 * 60 * 1000;

function throttled(email: string): boolean {
  const a = attempts.get(email);
  return !!a && a.count >= MAX_ATTEMPTS && a.until > Date.now();
}
function registerFailure(email: string) {
  const a = attempts.get(email);
  if (!a || a.until < Date.now()) attempts.set(email, { count: 1, until: Date.now() + WINDOW_MS });
  else a.count++;
}

export type LoginResult = { ok: true } | { ok: false; error: string };

export async function login(emailRaw: string, password: string): Promise<LoginResult> {
  const email = (emailRaw ?? "").trim().toLowerCase();
  if (!email || !password) return { ok: false, error: "Informe e-mail e senha." };
  if (throttled(email)) {
    return { ok: false, error: "Muitas tentativas. Espere 15 minutos ou redefina a senha." };
  }

  const [user] = await withBootstrap("login", (db) =>
    db<{ id: string; password_hash: string | null }[]>`
      SELECT id, password_hash FROM users WHERE email = ${email} AND deleted_at IS NULL
    `,
  );
  const ok = await verifyPassword(password, user?.password_hash);
  if (!user || !ok) {
    registerFailure(email);
    // Mensagem única: não revela se o e-mail existe.
    return { ok: false, error: "E-mail ou senha incorretos." };
  }
  attempts.delete(email);
  await startSession(user.id);
  return { ok: true };
}

/** Cria sessão e grava o cookie. Escolhe a primeira corretora ativa como ativa. */
export async function startSession(userId: string, preferredOrgId?: string): Promise<void> {
  const token = newToken();
  const h = await headers();
  const ua = (h.get("user-agent") ?? "").slice(0, 300);
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);

  await withBootstrap("criação de sessão", async (db) => {
    const memberships = await db<{ org_id: string }[]>`
      SELECT m.org_id FROM memberships m JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = ${userId} AND m.status = 'active'
        AND o.deleted_at IS NULL AND o.status NOT IN ('suspended','cancelled')
      ORDER BY (m.org_id = ${preferredOrgId ?? null}) DESC NULLS LAST, m.joined_at
    `;
    const active = memberships[0]?.org_id ?? null;
    await db`
      INSERT INTO sessions (user_id, token_hash, active_org_id, user_agent, expires_at)
      VALUES (${userId}, ${hashToken(token)}, ${active}, ${ua}, ${expires})
    `;
    await db`UPDATE users SET last_seen_at = now() WHERE id = ${userId}`;
  });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/",
    expires,
  });
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await withBootstrap("encerramento de sessão", (db) =>
      db`UPDATE sessions SET revoked_at = now() WHERE token_hash = ${hashToken(token)} AND revoked_at IS NULL`,
    );
  }
  jar.delete(SESSION_COOKIE);
}

/** Usuário corrente (uma consulta por requisição, via cache do React). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const [row] = await withBootstrap("leitura de sessão", (db) =>
    db<
      {
        session_id: string;
        user_id: string;
        name: string;
        email: string;
        active_org_id: string | null;
        is_platform_admin: boolean;
      }[]
    >`
      SELECT s.id AS session_id, u.id AS user_id, u.name, u.email::text AS email,
             s.active_org_id,
             EXISTS (SELECT 1 FROM platform_admins p WHERE p.user_id = u.id) AS is_platform_admin
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ${hashToken(token)}
        AND s.revoked_at IS NULL AND s.expires_at > now()
        AND u.deleted_at IS NULL
    `,
  );
  if (!row) return null;
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    activeOrgId: row.active_org_id,
    isPlatformAdmin: row.is_platform_admin,
  };
});

export const getMemberships = cache(async (userId: string): Promise<Membership[]> => {
  return withBootstrap("lista de corretoras do usuário", (db) =>
    db<Membership[]>`
      SELECT m.org_id AS "orgId", o.name AS "orgName", m.role, o.status AS "orgStatus"
      FROM memberships m JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = ${userId} AND m.status = 'active' AND o.deleted_at IS NULL
      ORDER BY o.name
    `,
  );
});

/** Sessão de tenant (org ativa) — ou null se o vínculo deixou de existir. */
export const getTenant = cache(async (): Promise<{ user: CurrentUser; session: Session } | null> => {
  const user = await getCurrentUser();
  if (!user || !user.activeOrgId) return null;
  const session = await resolveSession(user.userId, user.activeOrgId);
  if (!session) return null;
  return { user, session };
});

export async function switchOrganization(orgId: string): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  const session = await resolveSession(user.userId, orgId);
  if (!session) return false;
  await withBootstrap("troca de corretora ativa", (db) =>
    db`UPDATE sessions SET active_org_id = ${orgId} WHERE id = ${user.sessionId}`,
  );
  return true;
}

// ---------------------------------------------------------------------------
// Guardas de página: redirecionam em vez de lançar
// ---------------------------------------------------------------------------
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");
  return user;
}

export async function requireTenant(action?: Action): Promise<{ user: CurrentUser; session: Session }> {
  const user = await requireUser();
  const t = await getTenant();
  if (!t) {
    if (user.isPlatformAdmin) redirect("/plataforma");
    redirect("/sem-acesso");
  }
  if (action && !can(t.session, action)) redirect("/sem-permissao");
  return t;
}

export async function requirePlatformAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isPlatformAdmin) redirect("/sem-permissao");
  return user;
}
