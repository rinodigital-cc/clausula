/**
 * Cria (ou promove) um administrador da PLATAFORMA e imprime um link de
 * primeiro acesso para ele definir a senha. Nenhuma senha passa por aqui.
 *
 * Uso: DATABASE_URL_ADMIN=... APP_URL=... npm run plataforma:admin -- email@dominio "Nome Completo"
 */
import postgres from "postgres";
import { randomBytes, createHash } from "node:crypto";

const [email, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(" ").trim();
const url = process.env.DATABASE_URL_ADMIN;
if (!url || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || name.length < 2) {
  console.error('Uso: DATABASE_URL_ADMIN=... npm run plataforma:admin -- email@dominio "Nome Completo"');
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

async function main() {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  await sql.begin(async (tx) => {
    const [u] = await tx<{ id: string }[]>`
      INSERT INTO users (email, name) VALUES (${email!.toLowerCase()}, ${name})
      ON CONFLICT (email) WHERE deleted_at IS NULL DO UPDATE SET name = users.name
      RETURNING id
    `;
    await tx`INSERT INTO platform_admins (user_id) VALUES (${u!.id}) ON CONFLICT DO NOTHING`;
    await tx`
      INSERT INTO password_resets (user_id, token_hash, purpose, expires_at)
      VALUES (${u!.id}, ${hash}, 'first_access', now() + interval '24 hours')
    `;
  });
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  console.log(`Administrador da plataforma pronto: ${email}`);
  console.log(`Link de primeiro acesso (vale 24h, uso único):\n${base}/redefinir/${token}`);
}

main()
  .catch((e) => {
    console.error("FALHOU:", e.message);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
