import { withPublic } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/** Verificação de saúde para o provedor de hospedagem. Não expõe detalhes internos. */
export async function GET() {
  const started = Date.now();
  let db = false;
  try {
    await withPublic((sql) => sql`SELECT 1`);
    db = true;
  } catch {
    db = false;
  }
  return Response.json(
    { ok: db, db: db ? "ok" : "indisponivel", ms: Date.now() - started },
    { status: db ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
