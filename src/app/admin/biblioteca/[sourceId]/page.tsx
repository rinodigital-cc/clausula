import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/web";
import { DOC_TYPES, getDocument } from "@/lib/domain/documents";
import { listCatalog } from "@/lib/domain/catalog";
import { reprocessAction, toggleSourceAction, uploadAction } from "@/app/actions/admin";
import { ActionForm } from "@/ui/ActionForm";
import { SubmitButton } from "@/ui/client";
import { AutoRefresh } from "@/ui/AutoRefresh";
import { Alert, DocStatusBadge, formatDate, formatDateTime } from "@/ui/components";
import { FlashMessage } from "@/ui/flash";
import { UploadFields } from "@/app/admin/biblioteca/UploadFields";
import { IconArrowLeft, IconExternal } from "@/ui/icons";

export const metadata: Metadata = { title: "Documento · Administração" };

const KIND_LABEL: Record<string, string> = {
  coverage: "Cobertura",
  exclusion: "Exclusão",
  waiting_period: "Carência / condição",
  definition: "Definição",
  procedure: "Procedimento",
  general: "Geral",
  table: "Tabela",
};

function size(n: number | null) {
  if (!n) return "—";
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.round(n / 1024)} KB`;
}

export default async function AdminDocumento({ params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const { session } = await requireTenant("source.write");
  const [doc, catalog] = await Promise.all([getDocument(session, sourceId), listCatalog(session)]);
  if (!doc) notFound();
  const { source, versions, clauses } = doc;
  const current = versions.find((v) => v.isCurrent) ?? versions[0];
  const busy = versions.some((v) => v.status === "queued" || v.status === "processing");
  const isNote = source.kind === "internal_note";
  const docTypes = Object.entries(DOC_TYPES).filter(([k]) => k !== "nota_interna");

  return (
    <div className="stack-lg">
      <AutoRefresh active={busy} />
      <Link href="/admin/biblioteca" className="back-link">
        <IconArrowLeft size={16} /> Documentos
      </Link>
      <FlashMessage />

      <div className="page-head">
        <div className="stack-sm">
          <h1>{source.title}</h1>
          <p>{[source.insurerName, source.productName, DOC_TYPES[source.docType] ?? source.docType].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="row">
          {current ? <DocStatusBadge status={current.status} stage={current.stage} /> : null}
          {source.status !== "active" ? <span className="badge badge-neutral">Desativado</span> : null}
        </div>
      </div>

      {current?.status === "failed" ? (
        <Alert tone="danger" title="O processamento falhou.">
          {current.errorMessage ?? "Motivo não informado."} Corrija o arquivo e envie uma nova versão abaixo, ou tente processar de novo.
        </Alert>
      ) : null}
      {current?.status === "ready_with_warnings" && current.warnings ? (
        <Alert tone="warn" title="Pronto, com ressalvas.">
          {current.warnings.pages_without_text?.length
            ? `Páginas sem texto (não usadas nas respostas): ${current.warnings.pages_without_text.join(", ")}. `
            : ""}
          {current.warnings.suspicious_chunks
            ? `${current.warnings.suspicious_chunks} ${current.warnings.suspicious_chunks === 1 ? "trecho tem" : "trechos têm"} texto com aparência de instrução para sistemas e ${current.warnings.suspicious_chunks === 1 ? "foi deixado" : "foram deixados"} de fora por segurança.`
            : ""}
        </Alert>
      ) : null}
      {busy ? <Alert tone="info" title="Processando.">Esta tela se atualiza sozinha. Enquanto a nova versão não fica pronta, a anterior continua respondendo.</Alert> : null}

      <section className="card card-pad stack" aria-labelledby="versoes">
        <h2 id="versoes" style={{ fontSize: "var(--text-lg)" }}>Versões</h2>
        <div className="table-wrap" style={{ border: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Versão</th>
                <th scope="col">Situação</th>
                <th scope="col">Arquivo</th>
                <th scope="col">Páginas · trechos</th>
                <th scope="col">Vigência</th>
                <th scope="col">Enviada</th>
                <th scope="col"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td>
                    {v.versionNumber}
                    {v.isCurrent ? <span className="badge badge-evidence" style={{ marginLeft: 8 }}>Em uso</span> : null}
                  </td>
                  <td>
                    <DocStatusBadge status={v.status} stage={v.stage} />
                    {v.status === "failed" && v.errorMessage ? <div className="meta" style={{ color: "var(--danger)", marginTop: 4 }}>{v.errorMessage}</div> : null}
                  </td>
                  <td className="meta">{v.fileName ?? (isNote ? "Escrito na plataforma" : "—")}<br />{size(v.fileSize)}</td>
                  <td className="meta">{v.pageCount ?? "—"} · {v.chunkCount}</td>
                  <td className="meta">{v.validUntil ? `até ${formatDate(v.validUntil)}` : "—"}</td>
                  <td className="meta" style={{ whiteSpace: "nowrap" }}>{formatDateTime(v.createdAt)}</td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      {v.fileName ? (
                        <a href={`/api/documentos/${v.id}/arquivo`} target="_blank" rel="noopener" className="btn btn-ghost btn-sm">
                          PDF <IconExternal size={14} />
                        </a>
                      ) : null}
                      {["failed", "ready", "ready_with_warnings"].includes(v.status) && v.fileName ? (
                        <form action={reprocessAction}>
                          <input type="hidden" name="documento" value={source.id} />
                          <input type="hidden" name="versao" value={v.id} />
                          <SubmitButton className="btn btn-ghost btn-sm" pendingLabel="Enviando…">Processar de novo</SubmitButton>
                        </form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {clauses.length > 0 ? (
        <section className="card card-pad stack" aria-labelledby="estrutura">
          <div className="row-between">
            <h2 id="estrutura" style={{ fontSize: "var(--text-lg)" }}>Estrutura reconhecida</h2>
            <span className="meta">{clauses.length} cláusulas</span>
          </div>
          <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
            É assim que o documento foi dividido. Se uma exclusão aparecer como cobertura, por exemplo, vale revisar o PDF.
          </p>
          <details>
            <summary style={{ cursor: "pointer", fontSize: "var(--text-sm)" }}>Ver cláusulas</summary>
            <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", columns: "2 280px", fontSize: "var(--text-sm)" }}>
              {clauses.map((c) => (
                <li key={c.clausePath ?? ""} style={{ breakInside: "avoid", padding: "4px 0" }}>
                  <span className="mono">{c.clausePath}</span> {c.clauseTitle ?? ""}{" "}
                  <span className="meta">· {KIND_LABEL[c.sectionKind] ?? c.sectionKind}{c.page ? ` · p. ${c.page}` : ""}</span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}

      {!isNote ? (
        <section className="card card-pad stack" aria-labelledby="substituir">
          <h2 id="substituir" style={{ fontSize: "var(--text-lg)" }}>Enviar nova versão</h2>
          <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
            Use quando a seguradora publicar condições atualizadas. As consultas antigas continuam mostrando o trecho da versão que citaram.
          </p>
          <ActionForm action={uploadAction} encType="multipart/form-data" ariaLabel="Enviar nova versão">
            <input type="hidden" name="substituir" value={source.id} />
            <UploadFields insurers={catalog} docTypes={docTypes} defaults={{ title: source.title, insurerId: source.insurerId, productId: source.productId, docType: source.docType }} />
            <div className="row"><SubmitButton pendingLabel="Enviando…">Enviar nova versão</SubmitButton></div>
          </ActionForm>
        </section>
      ) : null}

      <section className="danger-zone stack-sm" aria-labelledby="uso">
        <h2 id="uso" style={{ fontSize: "var(--text-md)" }}>{source.status === "active" ? "Retirar das respostas" : "Voltar a usar nas respostas"}</h2>
        <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
          {source.status === "active"
            ? "O documento deixa de ser consultado. Nada é apagado e você pode reativar depois."
            : "O documento volta a ser usado nas consultas."}
        </p>
        <form action={toggleSourceAction}>
          <input type="hidden" name="documento" value={source.id} />
          <input type="hidden" name="ativar" value={source.status === "active" ? "0" : "1"} />
          <SubmitButton className={source.status === "active" ? "btn btn-danger" : "btn btn-secondary"}>
            {source.status === "active" ? "Desativar documento" : "Reativar documento"}
          </SubmitButton>
        </form>
      </section>
    </div>
  );
}
