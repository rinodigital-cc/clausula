import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { authClient } from "@/lib/supabase/server";
import { supabaseAuthEnabled } from "@/lib/supabase/config";
import { withBootstrap } from "@/lib/db/client";
import { hashToken, newToken } from "@/lib/auth/password";
import { SESSION_COOKIE } from "@/lib/auth/web";

async function finishRecovery(request: NextRequest, userId: string) {
  const token = newToken();
  const saved = await withBootstrap("recibo de recuperação Supabase", async db => {
    const [known] = await db`SELECT id FROM users WHERE id = ${userId} AND deleted_at IS NULL`;
    if (!known) return false;
    await db`INSERT INTO password_resets (user_id, token_hash, purpose, expires_at)
      VALUES (${userId}, ${hashToken(token)}, 'reset', ${new Date(Date.now() + 3600000)})`;
    return true;
  });
  if (!saved) return NextResponse.redirect(new URL("/recuperar?invalido=1", request.url));

  (await cookies()).delete(SESSION_COOKIE);
  const target = new URL(`/redefinir/${token}`, request.url);
  const safe = JSON.stringify(target.pathname + target.search);
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Definir nova senha · ApoIA Seguro</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f5f7fb;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0}.box{max-width:520px;padding:32px;text-align:center}p{color:#64748b}</style>
</head><body><main class="box"><h1>Acesso validado</h1><p>Direcionando para criar sua nova senha…</p><noscript><a href="${target.pathname}">Continuar</a></noscript></main>
<script>window.location.replace(${safe});</script></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

/** Callback de recuperação. Aceita PKCE/token_hash e também links antigos com fragmento. */
export async function GET(request: NextRequest) {
  const fail = () => NextResponse.redirect(new URL("/recuperar?invalido=1", request.url));
  if (!supabaseAuthEnabled()) return fail();

  const client = await authClient();
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  if (code || (tokenHash && type === "recovery")) {
    const result = code
      ? await client.auth.exchangeCodeForSession(code)
      : await client.auth.verifyOtp({ token_hash: tokenHash!, type: "recovery" });

    if (!result || result.error) return fail();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return fail();
    return finishRecovery(request, user.id);
  }

  // Links antigos do Supabase implicit flow carregam access_token/refresh_token no #fragment,
  // que nunca chega ao servidor. Servimos uma ponte mínima que lê o fragmento no browser,
  // estabelece a sessão Supabase e troca por um recibo de reset server-side.
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Recuperando acesso · ApoIA Seguro</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f5f7fb;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0}.box{max-width:520px;padding:32px;text-align:center}p{color:#64748b}</style>
</head><body><main class="box"><h1>Validando seu acesso…</h1><p>Você será direcionado para criar uma nova senha.</p></main>
<script>
(async function(){
  try {
    const h = new URLSearchParams(location.hash.slice(1));
    const access_token = h.get("access_token");
    const refresh_token = h.get("refresh_token");
    const type = h.get("type");
    if (!access_token || !refresh_token || (type && type !== "recovery")) throw new Error("invalid");
    const r = await fetch("/api/auth/recovery-fragment", {
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({access_token,refresh_token}),
      credentials:"same-origin"
    });
    const data = await r.json();
    if (!r.ok || !data.redirect) throw new Error("failed");
    location.replace(data.redirect);
  } catch {
    location.replace("/recuperar?invalido=1");
  }
})();</script></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}
