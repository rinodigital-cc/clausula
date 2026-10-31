/**
 * Executa uma suíte SQL com psql e EXIGE o número esperado de casos.
 * (A rodada de setembro achou uma suíte que declarava sucesso com 10 de 21.)
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { assertDisposableDatabase } from "./safety";

const file = process.argv[2];
if (!file) throw new Error("Uso: tsx tests/run-sql.ts arquivo.sql");
const expected = Number(readFileSync(file, "utf8").match(/@casos-esperados:\s*(\d+)/)?.[1] ?? NaN);
const url = process.env.DATABASE_URL_ADMIN;
if (!url) throw new Error("DATABASE_URL_ADMIN não definida");
assertDisposableDatabase();

const container = process.env.PSQL_CONTAINER;
const connection = new URL(url);
if (container) connection.port = "5432";
const args = [connection.toString(), "-X", "-q", "-A", "-F", "|", "-f", "-"];
const r = spawnSync(container ? "docker" : "psql", container
  ? ["--host=unix:///var/run/docker.sock", "exec", "-i", container, "psql", ...args]
  : args, { encoding: "utf8", input: readFileSync(file, "utf8") });
if (r.error || r.status !== 0) {
  console.error("Executor SQL falhou:", r.error?.message ?? r.stderr);
  process.exit(1);
}
const out = r.stdout + r.stderr;
const lines = out.split("\n").filter((l) => /^(PASS|FAIL)\|/.test(l));
for (const l of lines) {
  const [status, name, exp, act] = l.split("|");
  console.log(`${status}  ${name}${status === "FAIL" ? `  (esperado ${exp}, obtido ${act})` : ""}`);
}
const passed = lines.filter((l) => l.startsWith("PASS")).length;
const failed = lines.length - passed;
console.log(`\n${passed} de ${lines.length} casos PASSARAM (esperados: ${expected})`);
mkdirSync("test-results", { recursive: true });
writeFileSync(
  path.join("test-results", `${path.basename(file, ".sql")}.json`),
  JSON.stringify({ when: new Date().toISOString(), passed, failed, expected, lines }, null, 2),
);
if (failed > 0 || lines.length !== expected) {
  if (lines.length !== expected) console.error(`Número de casos diferente do esperado (${lines.length} ≠ ${expected}). Veja a saída:\n${out.slice(-3000)}`);
  process.exit(1);
}
