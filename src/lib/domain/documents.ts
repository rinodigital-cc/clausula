import "server-only";
import { withTenant, isUuid, type TenantSql } from "@/lib/db/client";
import type { Session } from "@/lib/auth/session";
import { authorize, can } from "@/lib/authz/policy";
import { recordAudit } from "@/lib/audit";
import { looksLikePdf, MAX_UPLOAD_BYTES, saveOriginal, sha256 } from "@/lib/storage";

/**
 * Biblioteca de documentos da corretora.
 *
 * Estados reais da versão (nunca "pronto" antes de a ingestão terminar):
 *   queued → processing → ready | ready_with_warnings | failed
 *   superseded = versão anterior, substituída por uma nova já pronta
 */
export const DOC_TYPES: Record<string, string> = {
  condicoes_gerais: "Condições gerais",
  manual: "Manual",
  procedimento: "Procedimento interno",
  tabela: "Tabela",
  nota_interna: "Conhecimento interno",
  outro: "Outro",
};

export const STATUS_LABEL: Record<string, string> = {
  queued: "Na fila",
  processing: "Processando",
  ready: "Pronto",
  ready_with_warnings: "Pronto com ressalvas",
  failed: "Falhou",
  superseded: "Substituído",
};

export async function defaultSpecialistId(tx: TenantSql): Promise<string> {
  const [s] = await tx<{ id: string }[]>`
    SELECT id FROM specialists WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1
  `;
  if (s) return s.id;
  const [created] = await tx<{ id: string }[]>`
    INSERT INTO specialists (org_id, name, branch, status, published_at, created_by)
    VALUES ((SELECT current_org()), 'Assistente da corretora', 'geral', 'published', now(), (SELECT current_actor()))
    RETURNING id
  `;
  return created!.id;
}

export type UploadInput = {
  file: File;
  title: string;
  insurerId?: string | null;
  productId?: string | null;
  docType: string;
  validFrom?: string | null;
  validUntil?: string | null;
  rightsConfirmed: boolean;
  replaceSourceId?: string | null;
};

function parseDate(v?: string | null): string | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("Data inválida.");
  return v;
}

export async function uploadDocument(session: Session, input: UploadInput): Promise<{ sourceId: string; versionId: string }> {
  authorize(session, "source.write");
  if (!input.rightsConfirmed) {
    throw new Error("Confirme que a corretora tem direito de usar este documento na plataforma.");
  }
  const f = input.file;
  if (!f || typeof f.arrayBuffer !== "function" || f.size === 0) throw new Error("Selecione um arquivo PDF.");
  if (f.size > MAX_UPLOAD_BYTES) throw new Error("O arquivo passa de 25 MB. Divida o documento ou comprima o PDF.");
  const data = new Uint8Array(await f.arrayBuffer());
  if (!looksLikePdf(data)) throw new Error("O arquivo não é um PDF válido.");
  if (!DOC_TYPES[input.docType] || input.docType === "nota_interna") throw new Error("Tipo de documento inválido.");
  const title = (input.title || f.name.replace(/\.pdf$/i, "")).trim().slice(0, 200);
  if (title.length < 2) throw new Error("Informe um título para o documento.");
  const validFrom = parseDate(input.validFrom);
  const validUntil = parseDate(input.validUntil);
  if (validFrom && validUntil && validUntil < validFrom) throw new Error("O fim da vigência é anterior ao início.");
  for (const id of [input.insurerId, input.productId, input.replaceSourceId]) {
    if (id && !isUuid(id)) throw new Error("Identificador inválido.");
  }

  const checksum = sha256(data);
  const fileKey = await saveOriginal(session.orgId, data);

  try {
    return await withTenant(session, async (tx) => {
      const specialistId = await defaultSpecialistId(tx);
      let sourceId = input.replaceSourceId ?? null;
      let versionNumber = 1;
      let isCurrent = true;

      if (sourceId) {
        const [src] = await tx<{ id: string; max: number | null }[]>`
          SELECT s.id, (SELECT max(version_number) FROM source_versions v WHERE v.source_id = s.id) AS max
          FROM knowledge_sources s WHERE s.id = ${sourceId} AND s.deleted_at IS NULL
        `;
        if (!src) throw new Error("Documento a substituir não encontrado.");
        versionNumber = (src.max ?? 0) + 1;
        // A versão anterior continua respondendo até a nova ficar pronta.
        isCurrent = false;
        await tx`
          UPDATE knowledge_sources SET title = ${title}, insurer_id = ${input.insurerId ?? null},
            product_id = ${input.productId ?? null}, doc_type = ${input.docType},
            rights_confirmed_by = ${session.userId}, rights_confirmed_at = now()
          WHERE id = ${sourceId}
        `;
      } else {
        const [src] = await tx<{ id: string }[]>`
          INSERT INTO knowledge_sources (org_id, specialist_id, kind, title, insurer, product, origin,
                                         insurer_id, product_id, doc_type, rights_confirmed_by, rights_confirmed_at, created_by)
          VALUES ((SELECT current_org()), ${specialistId}, 'org_document', ${title},
                  (SELECT name FROM insurers WHERE id = ${input.insurerId ?? null}::uuid),
                  (SELECT name FROM products WHERE id = ${input.productId ?? null}::uuid),
                  'upload', ${input.insurerId ?? null}, ${input.productId ?? null}, ${input.docType},
                  ${session.userId}, now(), ${session.userId})
          RETURNING id
        `;
        sourceId = src!.id;
      }

      const [version] = await tx<{ id: string }[]>`
        INSERT INTO source_versions (org_id, source_id, version_number, file_key, file_name, checksum_sha256,
                                     valid_from, valid_until, status, is_current, file_size, mime_type, stage, uploaded_by)
        VALUES ((SELECT current_org()), ${sourceId}, ${versionNumber}, ${fileKey}, ${f.name.slice(0, 200)}, ${checksum},
                ${validFrom}, ${validUntil}, 'queued', ${isCurrent}, ${f.size}, 'application/pdf', 'Na fila', ${session.userId})
        RETURNING id
      `;
      await tx`
        INSERT INTO ingestion_jobs (org_id, source_version_id) VALUES ((SELECT current_org()), ${version!.id})
      `;
      await recordAudit(tx, {
        actorId: session.userId,
        action: "document.uploaded",
        entityType: "source_version",
        entityId: version!.id,
        metadata: { title, version: versionNumber, size: f.size, replace: !!input.replaceSourceId },
      });
      return { sourceId: sourceId!, versionId: version!.id };
    });
  } catch (e) {
    if ((e as { code?: string; constraint_name?: string }).code === "23505") {
      throw new Error("Este arquivo já foi enviado para a corretora.");
    }
    throw e;
  }
}

export type DocumentRow = {
  sourceId: string;
  title: string;
  kind: string;
  docType: string;
  sourceStatus: string;
  insurerId: string | null;
  insurerName: string | null;
  productName: string | null;
  versionId: string | null;
  versionNumber: number | null;
  status: string | null;
  stage: string | null;
  errorMessage: string | null;
  validFrom: string | null;
  validUntil: string | null;
  pageCount: number | null;
  chunkCount: number;
  updatedAt: Date;
  pendingVersionStatus: string | null;
  citations30d: number;
  warnings: unknown;
};

export async function listDocuments(
  session: Session,
  f: { q?: string; insurerId?: string; status?: string; includeInactive?: boolean } = {},
): Promise<DocumentRow[]> {
  const admin = can(session, "source.read");
  if (!admin) authorize(session, "library.browse");
  const q = (f.q ?? "").trim().slice(0, 100);
  return withTenant(session, (tx) =>
    tx<DocumentRow[]>`
      SELECT s.id AS "sourceId", s.title, s.kind, s.doc_type AS "docType", s.status AS "sourceStatus",
             s.insurer_id AS "insurerId", i.name AS "insurerName", p.name AS "productName",
             v.id AS "versionId", v.version_number AS "versionNumber", v.status, v.stage,
             v.error_message AS "errorMessage", v.valid_from::text AS "validFrom", v.valid_until::text AS "validUntil",
             v.page_count AS "pageCount", v.chunk_count AS "chunkCount", coalesce(v.updated_at, s.updated_at) AS "updatedAt",
             v.warning_summary AS warnings,
             (SELECT pv.status FROM source_versions pv WHERE pv.source_id = s.id AND NOT pv.is_current
                AND pv.status IN ('queued','processing','failed') ORDER BY pv.version_number DESC LIMIT 1) AS "pendingVersionStatus",
             (SELECT count(*)::int FROM message_citations mc
                WHERE mc.source_version_id = v.id AND mc.id IS NOT NULL
                  AND EXISTS (SELECT 1 FROM messages m WHERE m.id = mc.message_id AND m.created_at > now() - interval '30 days')
             ) AS "citations30d"
      FROM knowledge_sources s
      LEFT JOIN LATERAL (
        SELECT * FROM source_versions sv WHERE sv.source_id = s.id
        ORDER BY sv.is_current DESC, sv.version_number DESC LIMIT 1
      ) v ON true
      LEFT JOIN insurers i ON i.id = s.insurer_id
      LEFT JOIN products p ON p.id = s.product_id
      WHERE s.deleted_at IS NULL
        AND (${admin && !!f.includeInactive} OR s.status = 'active')
        AND (${admin} OR v.status IN ('ready','ready_with_warnings'))
        AND (${q} = '' OR s.title ILIKE ${"%" + q + "%"} OR i.name ILIKE ${"%" + q + "%"} OR p.name ILIKE ${"%" + q + "%"})
        AND (${f.insurerId ?? null}::uuid IS NULL OR s.insurer_id = ${f.insurerId ?? null}::uuid)
        AND (${f.status ?? ""} = '' OR v.status = ${f.status ?? ""}
             OR (${f.status ?? ""} = 'expired' AND v.valid_until < current_date))
      ORDER BY coalesce(v.updated_at, s.updated_at) DESC
      LIMIT 300
    `,
  );
}

export type VersionRow = {
  id: string;
  versionNumber: number;
  status: string;
  stage: string | null;
  errorMessage: string | null;
  isCurrent: boolean;
  fileName: string | null;
  fileSize: number | null;
  pageCount: number | null;
  chunkCount: number;
  validFrom: string | null;
  validUntil: string | null;
  createdAt: Date;
  processedAt: Date | null;
  warnings: { pages_without_text?: number[]; suspicious_chunks?: number } | null;
};

export async function getDocument(session: Session, sourceId: string) {
  authorize(session, "source.read");
  if (!isUuid(sourceId)) return null;
  return withTenant(session, async (tx) => {
    const [source] = await tx<
      { id: string; title: string; docType: string; status: string; kind: string; insurerId: string | null; productId: string | null;
        insurerName: string | null; productName: string | null; createdAt: Date }[]
    >`
      SELECT s.id, s.title, s.doc_type AS "docType", s.status, s.kind, s.insurer_id AS "insurerId", s.product_id AS "productId",
             i.name AS "insurerName", p.name AS "productName", s.created_at AS "createdAt"
      FROM knowledge_sources s
      LEFT JOIN insurers i ON i.id = s.insurer_id
      LEFT JOIN products p ON p.id = s.product_id
      WHERE s.id = ${sourceId} AND s.deleted_at IS NULL
    `;
    if (!source) return null;
    const versions = await tx<VersionRow[]>`
      SELECT id, version_number AS "versionNumber", status, stage, error_message AS "errorMessage",
             is_current AS "isCurrent", file_name AS "fileName", file_size AS "fileSize", page_count AS "pageCount",
             chunk_count AS "chunkCount", valid_from::text AS "validFrom", valid_until::text AS "validUntil",
             created_at AS "createdAt", processed_at AS "processedAt", warning_summary AS warnings
      FROM source_versions WHERE source_id = ${sourceId} ORDER BY version_number DESC
    `;
    const clauses = await tx<{ clausePath: string | null; clauseTitle: string | null; sectionKind: string; page: number | null }[]>`
      SELECT DISTINCT ON (c.clause_path) c.clause_path AS "clausePath", c.clause_title AS "clauseTitle",
             c.section_kind AS "sectionKind", c.page_start AS page
      FROM chunks c JOIN source_versions v ON v.id = c.source_version_id
      WHERE v.source_id = ${sourceId} AND v.is_current AND c.clause_path IS NOT NULL
      ORDER BY c.clause_path, c.ordinal
      LIMIT 200
    `;
    return { source, versions, clauses };
  });
}

export async function reprocessVersion(session: Session, versionId: string): Promise<void> {
  authorize(session, "source.write");
  await withTenant(session, async (tx) => {
    const r = await tx`
      UPDATE source_versions SET status = 'queued', stage = 'Na fila', error_message = NULL
      WHERE id = ${versionId} AND status IN ('failed','ready','ready_with_warnings') AND file_key IS NOT NULL
    `;
    if (r.count === 0) throw new Error("Esta versão não pode ser reprocessada agora.");
    await tx`INSERT INTO ingestion_jobs (org_id, source_version_id) VALUES ((SELECT current_org()), ${versionId})`;
    await recordAudit(tx, { actorId: session.userId, action: "document.reprocessed", entityType: "source_version", entityId: versionId });
  });
}

export async function setSourceActive(session: Session, sourceId: string, active: boolean): Promise<void> {
  authorize(session, "source.write");
  await withTenant(session, async (tx) => {
    const r = await tx`UPDATE knowledge_sources SET status = ${active ? "active" : "inactive"} WHERE id = ${sourceId} AND deleted_at IS NULL`;
    if (r.count === 0) throw new Error("Documento não encontrado.");
    await recordAudit(tx, {
      actorId: session.userId,
      action: active ? "document.activated" : "document.deactivated",
      entityType: "knowledge_source",
      entityId: sourceId,
    });
  });
}

export type VersionFile = { fileKey: string; fileName: string; title: string };

/**
 * Acesso ao ORIGINAL. A leitura passa pela RLS: versão de outra corretora
 * simplesmente não existe para esta sessão (resposta 404, não 403).
 */
export async function getVersionFile(session: Session, versionId: string): Promise<VersionFile | null> {
  authorize(session, "library.browse");
  if (!isUuid(versionId)) return null;
  const admin = can(session, "source.read");
  return withTenant(session, async (tx) => {
    const [row] = await tx<{ file_key: string | null; file_name: string | null; title: string; status: string }[]>`
      SELECT v.file_key, v.file_name, s.title, v.status
      FROM source_versions v JOIN knowledge_sources s ON s.id = v.source_id
      WHERE v.id = ${versionId} AND s.deleted_at IS NULL
        AND (${admin} OR (s.status = 'active' AND v.status IN ('ready','ready_with_warnings','superseded')))
    `;
    if (!row || !row.file_key) return null;
    await recordAudit(tx, { actorId: session.userId, action: "document.opened", entityType: "source_version", entityId: versionId });
    return { fileKey: row.file_key, fileName: row.file_name ?? "documento.pdf", title: row.title };
  });
}

export type PageView = {
  versionId: string;
  title: string;
  insurerName: string | null;
  productName: string | null;
  versionNumber: number;
  validUntil: string | null;
  status: string;
  isCurrent: boolean;
  hasFile: boolean;
  pageCount: number;
  page: number;
  content: string;
};

export async function getPage(session: Session, versionId: string, page: number): Promise<PageView | null> {
  authorize(session, "library.browse");
  if (!isUuid(versionId)) return null;
  const admin = can(session, "source.read");
  const p = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  return withTenant(session, async (tx) => {
    const [meta] = await tx<
      { title: string; insurer_name: string | null; product_name: string | null; version_number: number; valid_until: string | null;
        status: string; is_current: boolean; file_key: string | null; page_count: number | null }[]
    >`
      SELECT s.title, i.name AS insurer_name, pr.name AS product_name, v.version_number, v.valid_until::text AS valid_until,
             v.status, v.is_current, v.file_key, v.page_count
      FROM source_versions v JOIN knowledge_sources s ON s.id = v.source_id
      LEFT JOIN insurers i ON i.id = s.insurer_id
      LEFT JOIN products pr ON pr.id = s.product_id
      WHERE v.id = ${versionId} AND s.deleted_at IS NULL
        AND (${admin} OR v.status IN ('ready','ready_with_warnings','superseded'))
    `;
    if (!meta) return null;
    const [pg] = await tx<{ content: string }[]>`
      SELECT content FROM document_pages WHERE source_version_id = ${versionId} AND page_number = ${p}
    `;
    return {
      versionId,
      title: meta.title,
      insurerName: meta.insurer_name,
      productName: meta.product_name,
      versionNumber: meta.version_number,
      validUntil: meta.valid_until,
      status: meta.status,
      isCurrent: meta.is_current,
      hasFile: !!meta.file_key,
      pageCount: meta.page_count ?? 1,
      page: p,
      content: pg?.content ?? "",
    };
  });
}
