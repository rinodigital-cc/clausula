import postgres from "postgres";
import { isSession, InvalidSessionError, type Session } from "@/lib/auth/session";

/**
 * Acesso ao banco com contexto de tenant (herdado da versão anterior do produto, Milestone 1).
 *
 * Threat Model R-02: `SET` sem `LOCAL` vaza contexto entre requisições quando
 * o pooler está em modo transação. A defesa é a API: este módulo não expõe
 * forma de rodar query com escopo de tenant fora de uma transação.
 *
 * Mudança ApoIA Seguro: pools criados sob demanda (o build do Next importa o
 * módulo sem banco disponível) e pools separados por papel de banco.
 */

type Pool = ReturnType<typeof postgres>;
export type TenantSql = postgres.TransactionSql<Record<string, never>>;
export type PrivilegedSql = Pool;

const pools = new Map<string, Pool>();

function pool(envVar: string, max: number): Pool {
  const existing = pools.get(envVar);
  if (existing) return existing;
  const url = process.env[envVar];
  if (!url) throw new Error(`${envVar} não definida`);
  // O Vercel escala instancias independentes. Uma conexao por pool/instancia
  // evita esgotar as conexoes do Supavisor; no Docker mantemos o max original.
  const p = postgres(url, {
    max: process.env.VERCEL ? 1 : max,
    idle_timeout: 20,
    connect_timeout: 10,
    // Pooler em modo transação quebra prepared statements nomeados.
    prepare: false,
    onnotice: () => {},
  });
  pools.set(envVar, p);
  return p;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/**
 * Executa `fn` numa transação com o contexto de tenant aplicado.
 * orgId e userId vêm SEMPRE da sessão verificada, nunca da requisição.
 */
export async function withTenant<T>(session: Session, fn: (tx: TenantSql) => Promise<T>): Promise<T> {
  if (!isSession(session)) throw new InvalidSessionError();
  if (!isUuid(session.orgId)) throw new Error("orgId inválido");
  if (!isUuid(session.userId)) throw new Error("userId inválido");

  return pool("DATABASE_URL", 10).begin(async (tx) => {
    await tx`SELECT set_config('app.current_org', ${session.orgId}, true)`;
    await tx`SELECT set_config('app.current_user', ${session.userId}, true)`;
    return fn(tx as unknown as TenantSql);
  }) as Promise<T>;
}

/**
 * Caminhos que acontecem ANTES de existir contexto de tenant: login, sessão,
 * aceite de convite, recuperação de senha. Papel `app_bootstrap`, sem BYPASSRLS.
 * `reason` vai para o log: permite contar quantos caminhos privilegiados existem.
 */
export async function withBootstrap<T>(reason: string, fn: (db: PrivilegedSql) => Promise<T>): Promise<T> {
  logPrivileged("bootstrap", reason);
  return fn(pool("BOOTSTRAP_DATABASE_URL", 4));
}

/** Operador da plataforma. Enxerga metadados de corretoras, nunca conhecimento. */
export async function withPlatform<T>(reason: string, fn: (db: PrivilegedSql) => Promise<T>): Promise<T> {
  logPrivileged("platform", reason);
  return fn(pool("PLATFORM_DATABASE_URL", 3));
}

/** Formulário público: o papel só consegue INSERIR lead. */
export async function withPublic<T>(fn: (db: PrivilegedSql) => Promise<T>): Promise<T> {
  return fn(pool("PUBLIC_DATABASE_URL", 2));
}

/** Worker de ingestão/e-mail. Define contexto de tenant por trabalho. */
export function workerPool(): Pool {
  return pool("WORKER_DATABASE_URL", 3);
}

function logPrivileged(kind: string, reason: string) {
  if (process.env.NODE_ENV === "test") return;
  console.info(JSON.stringify({ level: "info", event: "privileged_db_access", kind, reason }));
}

export async function closePools(): Promise<void> {
  await Promise.all([...pools.values()].map((p) => p.end({ timeout: 5 })));
  pools.clear();
}
