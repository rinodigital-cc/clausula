import { vercelOidcToken } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const base = (process.env.SUPABASE_URL ?? process.env.SUPABASE_AUTH_URL ?? "").replace(/\/$/, "");
  const oidc = await vercelOidcToken();
  const response = await fetch(base + "/functions/v1/auth-gateway", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${oidc}`,
    },
    body: JSON.stringify({ action: "recovery_link", email: "marcelorino@gmail.com" }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  return Response.json(body, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}
