import { vercelOidcToken } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = await vercelOidcToken();
  if (!token) return Response.json({ ok: false }, { status: 401 });

  const base = (process.env.SUPABASE_URL ?? process.env.SUPABASE_AUTH_URL ?? "").replace(/\/$/, "");
  const response = await fetch(base + "/functions/v1/bootstrap-platform-admin", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({ ok: false }));
  return Response.json(data, { status: response.status, headers: { "Cache-Control": "no-store" } });
}
