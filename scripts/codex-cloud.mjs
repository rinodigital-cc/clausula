import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Uso exclusivo de desenvolvimento: banco local isolado e dados SIMULADOS.
const root = fileURLToPath(new URL("../", import.meta.url));
const filename = path.join(root, ".env.codex.local");
const name = "apoia-codex-db";
const image = "pgvector/pgvector:pg16@sha256:0dd3149a06e4579a0d70d8fef9945636cd514005e7237deb27f9b67886f8dc4f";
const command = process.argv[2];
if (!["setup", "run"].includes(command)) throw new Error("Uso: node scripts/codex-cloud.mjs setup | run <comando> [argumentos]");

if (!existsSync(filename)) {
  if (command !== "setup") throw new Error("Execute primeiro: node scripts/codex-cloud.mjs setup");
  const secret = () => randomBytes(32).toString("hex");
  const admin = secret();
  const values = {
    POSTGRES_PASSWORD: admin,
    DATABASE_URL_ADMIN: `postgres://postgres:${admin}@127.0.0.1:55432/apoia_codex_test`,
    APP_URL: "http://localhost:3000",
    PUBLIC_SITE_URL: "http://localhost:3000",
    SESSION_SECRET: secret(),
    STORAGE_DIR: "./storage/codex",
    PSQL_CONTAINER: name,
    ALLOW_TEST_DB_RESET: "1",
  };
  for (const [role, variable] of [["APP", "DATABASE_URL"], ["BOOTSTRAP", "BOOTSTRAP_DATABASE_URL"], ["PLATFORM", "PLATFORM_DATABASE_URL"], ["WORKER", "WORKER_DATABASE_URL"], ["PUBLIC", "PUBLIC_DATABASE_URL"]]) {
    const password = secret();
    values[`DB_PASSWORD_${role}`] = password;
    values[variable] = `postgres://apoia_${role.toLowerCase()}:${password}@127.0.0.1:55432/apoia_codex_test`;
  }
  writeFileSync(filename, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""), { mode: 0o600, flag: "wx" });
}

const local = parseEnv(readFileSync(filename, "utf8"));
const env = { ...process.env, ...local, STORAGE_DIR: path.resolve(root, local.STORAGE_DIR ?? "./storage/codex"), ANTHROPIC_API_KEY: "", RESEND_API_KEY: "", EMAIL_TRANSPORT: "file" };
// O runtime gerenciado usa o daemon local. Não redirecionar por contexto herdado.
for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) delete env[key];
function run(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: root, env, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result;
}
const docker = (args, options) => run("docker", ["--host=unix:///var/run/docker.sock", ...args], options);

if (command === "run") {
  if (!process.argv[3]) throw new Error("Informe o comando a executar.");
  run(process.argv[3], process.argv.slice(4));
} else {
  docker(["info", "--format", "{{.ServerVersion}}"]);
  const inspect = spawnSync("docker", ["--host=unix:///var/run/docker.sock", "container", "inspect", name, "--format", '{{index .Config.Labels "apoia.codex.managed"}}'], { env, encoding: "utf8" });
  if (inspect.status === 0) {
    if (inspect.stdout.trim() !== "true") throw new Error("Nome do container já está em uso por outro serviço.");
    docker(["start", name]);
  } else {
    if (!inspect.stderr.includes("No such")) throw new Error("Não foi possível inspecionar o container local.");
    docker(["run", "-d", "--name", name, "--label", "apoia.codex.managed=true", "-e", "POSTGRES_PASSWORD", "-e", "POSTGRES_DB=apoia_codex_test", "-p", "127.0.0.1:55432:5432", "-v", "apoia-codex-db:/var/lib/postgresql/data", image]);
  }
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const result = spawnSync("docker", ["--host=unix:///var/run/docker.sock", "exec", name, "pg_isready", "-U", "postgres", "-d", "apoia_codex_test"], { env, stdio: "ignore" });
    if (result.status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("PostgreSQL não ficou pronto em 30 segundos.");
  run("npm", ["run", "db:migrate"]);
  run("npm", ["run", "db:roles"]);
  console.log("Banco local pronto. Execute: node scripts/codex-cloud.mjs run npm test");
}
