import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authClient } from "@/lib/supabase/server";
import { withBootstrap } from "@/lib/db/client";
import { hashToken, newToken } from "@/lib/auth/password";
import { SESSION_COOKIE } from "@/lib/auth/web";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const accessToken = typeof body.access_token === "string" ? body.access_token : "";
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
    if (!accessToken || !refreshToken || accessToken.length > 5000 || refreshToken.length > 5000) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const client = await authClient();
    const { data, error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error || !data.user) return NextResponse.json({ ok: false }, { status: 401 });

    const token = newToken();
    const saved = await withBootstrap("recibo de recuperação Supabase implicit", async db => {
      const [known] = await db`SELECT id FROM users WHERE id = ${data.user!.id} AND deleted_at IS NULL`;
      if (!known) return false;
      await db`INSERT INTO password_resets (user_id, token_hash, purpose, expires_at)
        VALUES (${data.user!.id}, ${hashToken(token)}, 'reset', ${new Date(Date.now() + 3600000)})`;
      return true;
    });
    if (!saved) return NextResponse.json({ ok: false }, { status: 403 });

    (await cookies()).delete(SESSION_COOKIE);
    const response = NextResponse.json({ ok: true, redirect: `/redefinir/${token}` });
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
