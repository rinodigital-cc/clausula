import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { authClient } from "@/lib/supabase/server";
import { supabaseAuthEnabled } from "@/lib/supabase/config";
import { withBootstrap } from "@/lib/db/client";
import { hashToken, newToken } from "@/lib/auth/password";
import { SESSION_COOKIE } from "@/lib/auth/web";

/** Callback exclusivo de recuperação. Não aceita destino arbitrário. */
export async function GET(request: NextRequest) {
  const fail = () => NextResponse.redirect(new URL("/recuperar?invalido=1", request.url));
  if (!supabaseAuthEnabled()) return fail();
  const client = await authClient();
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const result = code
    ? await client.auth.exchangeCodeForSession(code)
    : tokenHash && type === "recovery"
      ? await client.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" })
      : null;
  if (!result || result.error) return fail();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return fail();
  const token = newToken();
  const saved = await withBootstrap("recibo de recuperação Supabase", async db => {
    const [known] = await db`SELECT id FROM users WHERE id = ${user.id} AND deleted_at IS NULL`;
    if (!known) return false;
    await db`INSERT INTO password_resets (user_id, token_hash, purpose, expires_at)
      VALUES (${user.id}, ${hashToken(token)}, 'reset', ${new Date(Date.now() + 3600000)})`;
    return true;
  });
  if (!saved) {
    await client.auth.signOut({ scope: "local" });
    return fail();
  }
  (await cookies()).delete(SESSION_COOKIE);
  const response = NextResponse.redirect(new URL(`/redefinir/${token}`, request.url));
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
