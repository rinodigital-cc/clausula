import postgres from "postgres";
import { isSession, InvalidSessionError, type Session } from "@/lib/auth/session";

type Pool = ReturnType<typeof postgres>;
type QueryRows<T extends readonly unknown[] = readonly Record<string, unknown>[]> = T & { count: number };
export type SqlClient = {
  <T extends readonly unknown[] = readonly Record<string, unknown>[]>(strings: TemplateStringsArray, ...values: unknown[]): Promise<QueryRows<T>>;
  begin<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
};
export type TenantSql = SqlClient;
export type PrivilegedSql = SqlClient;

const pools = new Map<string, Pool>();

function pool(envVar: string, max: number): Pool {
  const existing = pools.get(envVar);
  if (existing) return existing;
  const url = process.env[envVar];
  if (!url) throw new Error(`${envVar} não definida`);
  const p = postgres(url, {
    max: process.env.VERCEL ? 1 : max,
    idle_timeout: 20,
    connect_timeout: 10,
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

function directClient(envVar: string, max: number): SqlClient {
  const p = pool(envVar, max);
  return p as unknown as SqlClient;
}

function normalizeParam(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return value.toString("base64");
  if (Array.isArray(value)) return value.map(normalizeParam);
  return value;
}

function revive(value: unknown): unknown {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, revive(v)]));
  }
  return value;
}

function compile(strings: TemplateStringsArray, values: unknown[]) {
  let sql = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) sql += `$${i + 1}${strings[i + 1] ?? ""}`;
  return { sql, params: values.map(normalizeParam) };
}

type RemoteKind = "tenant" | "bootstrap" | "platform" | "public" | "worker";

function remoteClient(kind: RemoteKind, context?: { orgId?: string; userId?: string }): SqlClient {
  const endpoint = (process.env.SUPABASE_URL ?? process.env.SUPABASE_AUTH_URL ?? "").replace(/\/$/, "") + "/functions/v1/db-gateway";

  const tagged = (async <T extends readonly unknown[] = readonly Record<string, unknown>[]>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<QueryRows<T>> => {
    if (!endpoint.startsWith("https://")) throw new Error("SUPABASE_URL não definida");
    const token = process.env.VERCEL_OIDC_TOKEN;
    if (!token) throw new Error("VERCEL_OIDC_TOKEN não disponível");
    const body = compile(strings, values);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ kind, ...context, ...body }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; rows?: unknown[]; count?: number; error?: string } | null;
    if (!response.ok || !payload?.ok || !Array.isArray(payload.rows)) {
      throw new Error(`DB Gateway indisponível (${response.status}:${payload?.error ?? "unknown"})`);
    }
    const rows = payload.rows.map(revive) as unknown as T & { count: number };
    Object.defineProperty(rows, "count", { value: payload.count ?? rows.length, enumerable: false });
    return rows;
  }) as SqlClient;

  tagged.begin = async <T>(fn: (tx: SqlClient) => Promise<T>) => fn(tagged);
  return tagged;
}

function client(envVar: string, max: number, kind: RemoteKind, context?: { orgId?: string; userId?: string }): SqlClient {
  return process.env[envVar] ? directClient(envVar, max) : remoteClient(kind, context);
}

export async function withTenant<T>(session: Session, fn: (tx: TenantSql) => Promise<T>): Promise<T> {
  if (!isSession(session)) throw new InvalidSessionError();
  if (!isUuid(session.orgId)) throw new Error("orgId inválido");
  if (!isUuid(session.userId)) throw new Error("userId inválido");

  if (process.env.DATABASE_URL) {
    return pool("DATABASE_URL", 10).begin(async (tx) => {
      await tx`SELECT set_config('app.current_org', ${session.orgId}, true)`;
      await tx`SELECT set_config('app.current_user', ${session.userId}, true)`;
      return fn(tx as unknown as TenantSql);
    }) as Promise<T>;
  }
  return fn(remoteClient("tenant", { orgId: session.orgId, userId: session.userId }));
}

export async function withBootstrap<T>(reason: string, fn: (db: PrivilegedSql) => Promise<T>): Promise<T> {
  logPrivileged("bootstrap", reason);
  return fn(client("BOOTSTRAP_DATABASE_URL", 4, "bootstrap"));
}

export async function withPlatform<T>(reason: string, fn: (db: PrivilegedSql) => Promise<T>): Promise<T> {
  logPrivileged("platform", reason);
  return fn(client("PLATFORM_DATABASE_URL", 3, "platform"));
}

export async function withPublic<T>(fn: (db: PrivilegedSql) => Promise<T>): Promise<T> {
  return fn(client("PUBLIC_DATABASE_URL", 2, "public"));
}

export function workerPool(): SqlClient {
  return client("WORKER_DATABASE_URL", 3, "worker");
}

export async function withWorkerTenant<T>(orgId: string, fn: (db: SqlClient) => Promise<T>): Promise<T> {
  if (!isUuid(orgId)) throw new Error("orgId inválido");
  if (process.env.WORKER_DATABASE_URL) {
    return pool("WORKER_DATABASE_URL", 3).begin(async (tx) => {
      await tx`SELECT set_config('app.current_org', ${orgId}, true)`;
      return fn(tx as unknown as SqlClient);
    }) as Promise<T>;
  }
  return fn(remoteClient("worker", { orgId }));
}

function logPrivileged(kind: string, reason: string) {
  if (process.env.NODE_ENV === "test") return;
  console.info(JSON.stringify({ level: "info", event: "privileged_db_access", kind, reason }));
}

export async function closePools(): Promise<void> {
  await Promise.all([...pools.values()].map((p) => p.end({ timeout: 5 })));
  pools.clear();
}
