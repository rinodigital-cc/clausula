/**
 * Worker: processo separado da aplicação web.
 *   npm run worker            → laço contínuo (produção)
 *   npm run worker -- --once  → esvazia a fila e sai (testes, operação manual)
 */
import postgres from "postgres";
import { processOneJob } from "./ingest";
import { dispatchEmails } from "./email";

const url = process.env.WORKER_DATABASE_URL;
if (!url) {
  console.error("WORKER_DATABASE_URL não definida.");
  process.exit(1);
}
const sql = postgres(url, { max: 2, prepare: false, onnotice: () => {} });
const once = process.argv.includes("--once");
let stopping = false;

async function drain(): Promise<number> {
  let n = 0;
  for (;;) {
    const r = await processOneJob(sql);
    if (!r) break;
    n++;
    console.info(JSON.stringify({ level: "info", event: "ingestion_job", ...r }));
  }
  const e = await dispatchEmails(sql);
  if (e.sent || e.skipped || e.failed) console.info(JSON.stringify({ level: "info", event: "email_dispatch", ...e }));
  return n;
}

async function main() {
  console.info(JSON.stringify({ level: "info", event: "worker_start", mode: once ? "once" : "loop" }));
  if (once) {
    await drain();
    await sql.end();
    return;
  }
  process.on("SIGTERM", () => (stopping = true));
  process.on("SIGINT", () => (stopping = true));
  while (!stopping) {
    try {
      const n = await drain();
      if (n === 0) await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      console.error(JSON.stringify({ level: "error", event: "worker_loop", message: (e as Error).message }));
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
