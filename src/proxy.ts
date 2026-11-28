import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig, supabaseAuthEnabled } from "@/lib/supabase/config";

export async function proxy(request: NextRequest) {
  if (!supabaseAuthEnabled()) return NextResponse.next();
  const { url, key } = authConfig();
  let response = NextResponse.next({ request });
  const client = createServerClient(url, key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await client.auth.getUser();
  const protectedPage = /^\/(app|admin|plataforma)(\/|$)/.test(request.nextUrl.pathname);
  if (!user && protectedPage) {
    const destination = new URL("/entrar", request.url);
    destination.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    const redirect = NextResponse.redirect(destination);
    response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
    response = redirect;
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*", "/plataforma/:path*", "/api/documentos/:path*", "/entrar", "/recuperar", "/redefinir/:path*", "/auth/:path*", "/convite/:path*", "/sem-acesso", "/sem-permissao"],
};
