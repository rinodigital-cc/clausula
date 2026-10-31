/**
 * Aplicador de migrações.
 *
 * - Lê db/migrations/*.sql em ordem lexicográfica (0006b entra entre 0006 e 0007).
 * - Cada arquivo roda numa transação e fica registrado em schema_migrations
 *   com o hash do conteúdo. Arquivo já aplicado com conteúdo DIFERENTE é erro:
 *   migração aplicada não se edita, cria-se outra.
 * - Nunca apaga nada. Não há "down".
 *
 * Uso: DATABASE_URL_ADMIN=postgres://... npm run db:migrate
 */
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL_ADMIN;
if (!url) {
  console.error("Defina DATABASE_URL_ADMIN (papel dono do schema).");
  process.exit(1);
}

const dir = path.join(__dirname, "migrations");
const sql = postgres(url, { onnotice: () => {}, max: 1 });

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;
  const applied = new Map(
    (await sql<{ name: string; checksum: string }[]>`SELECT name, checksum FROM schema_migrations`).map(
      (r) => [r.name, r.checksum],
    ),
  );

  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let count = 0;
  for (const file of files) {
    const body = readFileSync(path.join(dir, file), "utf8");
    const checksum = createHash("sha256").update(body).digest("hex");
    const previous = applied.get(file);
    if (previous) {
      if (previous !== checksum) {
        throw new Error(`Migração ${file} já aplicada foi alterada. Crie uma nova migração.`);
      }
      continue;
    }
    process.stdout.write(`aplicando ${file} ... `);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (name, checksum) VALUES (${file}, ${checksum})`;
    });
    console.log("ok");
    count++;
  }
  console.log(count ? `${count} migração(ões) aplicada(s).` : "Banco já está atualizado.");
}

main()
  .catch((e) => {
    console.error("\nFALHOU:", e.message);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
