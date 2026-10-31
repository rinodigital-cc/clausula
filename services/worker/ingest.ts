/**
 * Ingestão de um documento: extrai → divide por cláusula → indexa.
 *
 * O worker roda com o papel `app_worker` e define o contexto de tenant DO
 * TRABALHO antes de tocar em qualquer dado: a RLS continua valendo para ele.
 * Estados reais, nesta ordem: queued → processing → ready | ready_with_warnings | failed.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type postgres from "postgres";
import { dividirDocumento } from "../ai/nucleo";
import { extractPdf, ExtractionError } from "../ai/extract";

type Sql = ReturnType<typeof postgres>;
type Tx = postgres.TransactionSql<Record<string, never>>;

const SECTION_MAP: Record<string, string> = {
  coverage: "coverage",
  exclusion: "exclusion",
  condition: "waiting_period",
  definition: "definition",
  procedure: "procedure",
  other: "general",
};

const KEY_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/;

async function inTenant<T>(sql: Sql, orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_org', ${orgId}, true)`;
    return fn(tx as unknown as Tx);
  }) as Promise<T>;
}

async function setStage(sql: Sql, orgId: string, versionId: string, stage: string, status = "processing") {
  await inTenant(sql, orgId, (tx) => tx`UPDATE source_versions SET status = ${status}, stage = ${stage} WHERE id = ${versionId}`);
}

export type JobOutcome = { jobId: string; versionId: string; status: "ready" | "ready_with_warnings" | "failed" | "retry"; detail?: string };

/** Processa UM trabalho da fila, se houver. Devolve null quando a fila está vazia. */
export async function processOneJob(sql: Sql): Promise<JobOutcome | null> {
  const [job] = await sql<{ job_id: string; org_id: string; source_version_id: string; attempts: number }[]>`
    SELECT * FROM claim_ingestion_job()
  `;
  if (!job) return null;
  const { job_id: jobId, org_id: orgId, source_version_id: versionId } = job;

  try {
    const meta = await inTenant(sql, orgId, async (tx) => {
      const [v] = await tx<{ file_key: string | null; source_id: string; is_current: boolean; specialist_id: string }[]>`
        SELECT v.file_key, v.source_id, v.is_current, s.specialist_id
        FROM source_versions v JOIN knowledge_sources s ON s.id = v.source_id
        WHERE v.id = ${versionId}
      `;
      return v;
    });
    if (!meta || !meta.file_key || !KEY_RE.test(meta.file_key)) {
      throw new ExtractionError("arquivo ausente", "O arquivo original não foi encontrado. Envie o documento de novo.");
    }

    await setStage(sql, orgId, versionId, "Lendo arquivo");
    const root = path.resolve(process.env.STORAGE_DIR ?? "./storage");
    const data = new Uint8Array(await readFile(path.join(root, meta.file_key)));

    await setStage(sql, orgId, versionId, "Extraindo texto");
    const { pages, pageCount } = await extractPdf(data);
    const pagesWithoutText = pages.map((t, i) => (t.replace(/\s/g, "").length < 20 ? i + 1 : 0)).filter(Boolean);
    const totalChars = pages.reduce((n, t) => n + t.replace(/\s/g, "").length, 0);
    if (totalChars < 80 || pagesWithoutText.length / Math.max(1, pageCount) > 0.8) {
      throw new ExtractionError(
        "sem camada de texto",
        "O PDF não tem texto selecionável (provavelmente é digitalizado). Reconhecimento de texto em imagem ainda não está disponível: envie a versão digital do documento.",
      );
    }

    await setStage(sql, orgId, versionId, `Organizando por cláusula (${pageCount} páginas)`);
    const trechos = dividirDocumento(pages);
    const suspicious = trechos.filter((t) => t.suspicious).length;

    await inTenant(sql, orgId, async (tx) => {
      // Reprocessamento: apaga o que a própria versão tinha (worker tem DELETE desde a 0010).
      await tx`DELETE FROM chunks WHERE source_version_id = ${versionId}`;
      await tx`DELETE FROM document_pages WHERE source_version_id = ${versionId}`;

      for (let i = 0; i < pages.length; i++) {
        await tx`
          INSERT INTO document_pages (org_id, source_version_id, page_number, content)
          VALUES (${orgId}, ${versionId}, ${i + 1}, ${pages[i] ?? ""})
        `;
      }
      let ordinal = 0;
      for (const t of trechos) {
        ordinal++;
        await tx`
          INSERT INTO chunks (org_id, specialist_id, source_version_id, ordinal, clause_path, clause_title, section_kind,
                              page_start, page_end, content, heading_trail, suspicious)
          VALUES (${orgId}, ${meta.specialist_id}, ${versionId}, ${ordinal}, ${t.clause_path}, ${t.clause_title},
                  ${SECTION_MAP[t.section_kind] ?? "general"}, ${t.page_number}, ${t.page_number}, ${t.content},
                  ${t.heading_trail}, ${t.suspicious})
        `;
      }

      const warnings =
        pagesWithoutText.length || suspicious
          ? { pages_without_text: pagesWithoutText, suspicious_chunks: suspicious }
          : null;
      const status = warnings ? "ready_with_warnings" : "ready";

      // Nova versão de um documento existente: a anterior só sai de cena AGORA, pronta a nova.
      if (!meta.is_current) {
        await tx`
          UPDATE source_versions SET is_current = false, status = 'superseded', stage = 'Substituída'
          WHERE source_id = ${meta.source_id} AND is_current
        `;
      }
      await tx`
        UPDATE source_versions SET status = ${status}, stage = ${status === "ready" ? "Pronto" : "Pronto com ressalvas"},
               is_current = true, page_count = ${pageCount}, chunk_count = ${ordinal}, processed_at = now(),
               error_message = NULL, warning_summary = ${warnings ? JSON.stringify(warnings) : null}::text::jsonb
        WHERE id = ${versionId}
      `;
      await tx`UPDATE ingestion_jobs SET status = 'done', last_error = NULL WHERE id = ${jobId}`;
      await tx`
        INSERT INTO audit_logs (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
        VALUES (${orgId}, NULL, 'system', 'document.processed', 'source_version', ${versionId},
                ${JSON.stringify({ pages: pageCount, chunks: ordinal, status })}::text::jsonb)
      `;
    });
    return { jobId, versionId, status: pagesWithoutText.length || suspicious ? "ready_with_warnings" : "ready" };
  } catch (e) {
    const err = e as Error;
    const userMessage = err instanceof ExtractionError ? err.userMessage : "Falha inesperada ao processar. Tente reprocessar.";
    const permanent = err instanceof ExtractionError;
    const lastAttempt = job.attempts >= 3;
    console.error(JSON.stringify({ level: "error", event: "ingestion_failed", jobId, versionId, message: err.message }));
    await inTenant(sql, orgId, async (tx) => {
      if (permanent || lastAttempt) {
        await tx`UPDATE source_versions SET status = 'failed', stage = 'Falhou', error_message = ${userMessage} WHERE id = ${versionId}`;
        await tx`UPDATE ingestion_jobs SET status = 'failed', last_error = ${err.message.slice(0, 500)} WHERE id = ${jobId}`;
      } else {
        const backoff = 30 * 2 ** (job.attempts - 1);
        await tx`UPDATE source_versions SET status = 'queued', stage = 'Aguardando nova tentativa' WHERE id = ${versionId}`;
        await tx`
          UPDATE ingestion_jobs SET status = 'queued', last_error = ${err.message.slice(0, 500)},
                 run_after = now() + make_interval(secs => ${backoff})
          WHERE id = ${jobId}
        `;
      }
    });
    return { jobId, versionId, status: permanent || lastAttempt ? "failed" : "retry", detail: userMessage };
  }
}
