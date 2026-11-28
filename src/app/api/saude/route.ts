import { withPublic } from "@/lib/db/client";
import { emailProviderConfigured } from "../../../../services/worker/email";
import { generativeAvailable } from "../../../../services/ai/answer";

export const dynamic = "force-dynamic";

const DB_VARS = ["DATABASE_URL", "BOOTSTRAP_DATABASE_URL", "PLATFORM_DATABASE_URL", "WORKER_DATABASE_URL", "PUBLIC_DATABASE_URL"];

/**
 * Verificação de saúde. Diagnóstico sem segredo: apenas o MODO de cada
 * dependência (nunca valores, hosts ou chaves).
 */
export async function GET() {
  const started = Date.now();
  let db = false;
  try {
    await withPublic((sql) => sql`SELECT 1`);
    db = true;
  } catch (e) {
    db = false;
    console.error(JSON.stringify({ event: "health_db_failed", message: e instanceof Error ? e.message.slice(0, 200) : String(e) }));
  }
  const direct = DB_VARS.filter((v) => !!process.env[v]).length;
  const body = {
    ok: db,
    db: db ? "ok" : "indisponivel",
    modo_banco: direct === DB_VARS.length ? "direto" : direct === 0 ? "gateway" : "misto",
    email: emailProviderConfigured() ? "provedor" : "pendente",
    auth: process.env.AUTH_PROVIDER === "supabase" ? "supabase" : "legado",
    ia: generativeAvailable() ? "generativa" : "literal",
    versao: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
    ms: Date.now() - started,
  };
  return Response.json(body, { status: db ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
