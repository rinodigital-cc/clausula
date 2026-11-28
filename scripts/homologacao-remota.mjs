#!/usr/bin/env node
/**
 * Smoke remoto nao-destrutivo para homologacao do ApoIA Seguro.
 *
 * Requer um staging dedicado. Nao cria usuarios, nao envia PDFs,
 * nao dispara mensagens e nao modifica tabelas.
 *
 * HOMOLOG_URL=https://<host-de-homologacao> node scripts/homologacao-remota.mjs
 * Opcional: VERCEL_AUTOMATION_BYPASS_SECRET, se o preview for protegido.
 *
 * IMPORTANTE: um smoke OK NAO homologa login, IA, worker, e-mail nem RLS.
 */
const base = process.env.HOMOLOG_URL?.trim();
if (!base) {
  console.error("BLOQUEADO: HOMOLOG_URL nao configurada; nenhum teste remoto foi realizado.");
  process.exit(2);
}
let url;
try { url = new URL(base); } catch { console.error("HOMOLOG_URL invalida"); process.exit(2); }
if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
  console.error("HOMOLOG_URL deve ser uma origem HTTPS sem credenciais, path ou parametros.");
  process.exit(2);
}
if (["apoiaseguro.com.br", "www.apoiaseguro.com.br", "app.apoiaseguro.com.br"].includes(url.hostname) &&
    process.env.HOMOLOG_PERMITIR_DOMINIO_OFICIAL !== "sim") {
  console.error("BLOQUEADO: dominio oficial nao e permitido para testes sem autorizacao explicita.");
  process.exit(2);
}
const checks = [];
const timeout = 15000;
const headers = { "Cache-Control": "no-cache" };
if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
  headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
}
async function check(name, path, validate) {
  try {
    const response = await fetch(new URL(path, url), {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(timeout),
    });
    const result = await validate(response);
    checks.push({ name, passed: result === true, result: typeof result === "string" ? result : "HTTP " + response.status });
  } catch (e) {
    checks.push({ name, passed: false, result: e?.name === "TimeoutError" ? "timeout" : String(e?.message || e).slice(0, 160) });
  }
}
const html = async response =>
  response.status === 200 && (response.headers.get("content-type") || "").includes("text/html")
    ? true : "HTTP " + response.status + " (esperado HTML 200)";
await check("Pagina inicial", "/", html);
await check("Login", "/entrar", html);
await check("Privacidade", "/privacidade", html);
await check("Banco de dados", "/api/saude", async response => {
  if (response.status !== 200) return "HTTP " + response.status + " (necessario 200)";
  try {
    const j = await response.json();
    return j?.ok === true && j?.db === "ok" ? true : "resposta de saude sem banco OK";
  } catch {
    return "resposta nao e JSON de saude (possivel protecao ou redirecionamento)";
  }
});
for (const c of checks) console.log((c.passed ? "OK" : "FALHA") + " | " + c.name + " | " + c.result);
console.log("\nNAO VERIFICADO POR ESTE SMOKE (provas de homologacao obrigatorias):");
for (const item of [
  "login e criacao de sessao com usuario real de testes",
  "autorizacao e isolamento entre duas corretoras (RLS)",
  "upload de PDF, persistencia, ingestao pelo worker e recuperacao do arquivo",
  "resposta fundamentada com citacoes verificaveis",
  "chamada ao provedor real de IA, custo e fallback",
  "entrega efetiva de e-mail de convite e recuperacao de senha",
]) console.log("PENDENTE | " + item);
console.log("\nResultado HTTP: " + checks.filter(x => x.passed).length + "/" + checks.length + " verificacoes.");
if (checks.some(x => !x.passed)) process.exitCode = 1;
