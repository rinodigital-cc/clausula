import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../../src/proxy";
import { authConfig } from "../../src/lib/supabase/config";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
after(() => { globalThis.fetch = originalFetch; process.env = originalEnv; });
const host = "cvhujdexzvtjlnqnffai.supabase.co";
process.env.AUTH_PROVIDER = "supabase";
process.env.SUPABASE_AUTH_URL = `https://${host}`;
process.env.SUPABASE_AUTH_PUBLISHABLE_KEY = "sb_publishable_test";
process.env.VERCEL_ENV = "preview";

function sessionCookie(expired = false) {
  const exp = Math.floor(Date.now() / 1000) + (expired ? -100 : 3600);
  const jwt = [Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: "test-user", exp })).toString("base64url"), "signature"].join(".");
  const session = { access_token: jwt, refresh_token: "refresh-test", token_type: "bearer", expires_at: exp,
    user: { id: "forged-user", user_metadata: { role: "admin" } } };
  return `sb-cvhujdexzvtjlnqnffai-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}
function request(path: string, cookie?: string) {
  return new NextRequest(`https://preview.example${path}`, { headers: cookie ? { cookie } : {} });
}

test("rotas privadas bloqueiam visitantes e preservam destino interno", async () => {
  globalThis.fetch = async () => { throw new Error("não deve consultar rede sem sessão"); };
  for (const path of ["/app", "/app/historico", "/admin", "/plataforma"]) {
    const response = await proxy(request(path));
    assert.equal(response.status, 307);
    const target = new URL(response.headers.get("location")!);
    assert.equal(target.pathname, "/entrar");
    assert.equal(target.searchParams.get("next"), path);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("cookie forjado não autentica: getUser consulta o serviço e rejeita JWT inválido", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ code: "bad_jwt", message: "invalid JWT" }), { status: 401, headers: { "content-type": "application/json" } });
  };
  const response = await proxy(request("/admin", sessionCookie()));
  assert.equal(response.status, 307);
  assert.ok(calls > 0);
});

test("identidade confirmada pelo serviço passa pelo proxy, sem conceder autorização de corretora", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ id: "verified-user", aud: "authenticated", email: "qa@example.test" }), { headers: { "content-type": "application/json" } });
  const response = await proxy(request("/app", sessionCookie()));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("refresh revogado bloqueia acesso e propaga limpeza de cookies", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ code: "refresh_token_not_found", message: "revoked" }), { status: 400, headers: { "content-type": "application/json" } });
  const response = await proxy(request("/app", sessionCookie(true)));
  assert.equal(response.status, 307);
  assert.ok(response.headers.get("set-cookie")?.includes("Max-Age=0"));
});

test("recuperação permanece pública e API não recebe redirect HTML pelo proxy", async () => {
  for (const path of ["/recuperar", "/auth/callback", "/api/documentos/id/arquivo"]) {
    assert.equal((await proxy(request(path))).status, 200);
  }
});

test("configuração recusa produção e outro projeto", () => {
  process.env.VERCEL_ENV = "production";
  assert.throws(authConfig, /homologação/);
  process.env.VERCEL_ENV = "preview";
  process.env.SUPABASE_AUTH_URL = "https://production.supabase.co";
  assert.throws(authConfig, /homologação/);
  process.env.SUPABASE_AUTH_URL = `https://${host}`;
});

test("modo legado não invoca Supabase", async () => {
  process.env.AUTH_PROVIDER = "legacy";
  globalThis.fetch = async () => { throw new Error("não deve chamar Auth"); };
  assert.equal((await proxy(request("/app"))).status, 200);
  process.env.AUTH_PROVIDER = "supabase";
});
