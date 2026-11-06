/**
 * Cria (ou atualiza a senha de) um usuário de LOGIN para cada papel de runtime.
 *
 * Os papéis app_* das migrações são NOLOGIN de propósito: a migração define
 * PRIVILÉGIO; este script define CREDENCIAL, que muda por ambiente e nunca
 * vai para o repositório.
 *
 *   apoia_app       → app_user       (aplicação web, RLS sempre)
 *   apoia_bootstrap → app_bootstrap  (login, convite, criação de corretora)
 *   apoia_platform  → app_platform   (painel do operador da plataforma)
 *   apoia_worker    → app_worker     (ingestão e despacho de e-mail)
 *   apoia_public    → app_public     (formulário do site: só insere lead)
 *
 * Senhas vêm do ambiente (DB_PASSWORD_APP, DB_PASSWORD_BOOTSTRAP, ...).
 * Uso: DATABASE_URL_ADMIN=... DB_PASSWORD_APP=... npm run db:roles
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL_ADMIN;
if (!url) {
  console.error("Defina DATABASE_URL_ADMIN.");
  process.exit(1);
}

const ROLES: Array<[login: string, group: string, envVar: string]> = [
  ["apoia_app", "app_user", "DB_PASSWORD_APP"],
  ["apoia_bootstrap", "app_bootstrap", "DB_PASSWORD_BOOTSTRAP"],
  ["apoia_platform", "app_platform", "DB_PASSWORD_PLATFORM"],
  ["apoia_worker", "app_worker", "DB_PASSWORD_WORKER"],
  ["apoia_public", "app_public", "DB_PASSWORD_PUBLIC"],
];

const sql = postgres(url, { onnotice: () => {}, max: 1 });

async function main() {
  for (const [login, group, envVar] of ROLES) {
    const password = process.env[envVar];
    if (!password || password.length < 16) {
      throw new Error(`${envVar} ausente ou curta (mínimo 16 caracteres).`);
    }
    const exists = await sql`SELECT 1 FROM pg_roles WHERE rolname = ${login}`;
    if (exists.length === 0) {
      await sql.unsafe(`CREATE ROLE ${login} LOGIN NOINHERIT NOBYPASSRLS`);
    }
    // INHERIT só do papel de grupo correspondente; nada além dele.
    await sql.unsafe(`ALTER ROLE ${login} INHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    await sql.unsafe(`GRANT ${group} TO ${login}`);
    await sql.unsafe(`ALTER ROLE ${login} PASSWORD '${password.replace(/'/g, "''")}'`);
    console.log(`ok  ${login} → ${group}`);
  }
}

main()
  .catch((e) => {
    console.error("FALHOU:", e.message);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
