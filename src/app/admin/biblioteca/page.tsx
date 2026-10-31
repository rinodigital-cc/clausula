import type { Metadata } from "next";
import Link from "next/link";
import { requireTenant } from "@/lib/auth/web";
import { DOC_TYPES, listDocuments } from "@/lib/domain/documents";
import { listCatalog } from "@/lib/domain/catalog";
import { uploadAction } from "@/app/actions/admin";
import { ActionForm } from "@/ui/ActionForm";
import { SubmitButton } from "@/ui/client";
import { AutoRefresh } from "@/ui/AutoRefresh";
import { DocStatusBadge, EmptyState, PageHead, formatDate, formatDateTime } from "@/ui/components";
import { FlashMessage } from "@/ui/flash";
import { UploadFields } from "@/app/admin/biblioteca/UploadFields";
import { IconUpload } from "@/ui/icons";

export const metadata: Metadata = { title: "Documentos · Administração" };

const FILTERS: [string, string][] = [
  ["", "Todos"],
  ["ready", "Prontos"],
  ["ready_with_warnings", "Com ressalvas"],
  ["processing", "Processando"],
  ["failed", "Falharam"],
  ["expired", "Vencidos"],
];

export default async function AdminBiblioteca({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { session } = await requireTenant("source.write");
  const [docs, catalog] = await Promise.all([
    listDocuments(session, { q: sp.q, status: sp.status, includeInactive: true }),
    listCatalog(session),
  ]);
  const busy = docs.some((d) => d.status === "queued" || d.status === "processing" || d.pendingVersionStatus === "queued" || d.pendingVersionStatus === "processing");
  const docTypes = Object.entries(DOC_TYPES).filter(([k]) => k !== "nota_interna");
  const openUpload = sp.enviar === "1" || docs.length === 0;

  return (
    <div className="stack-lg">
      <AutoRefresh active={busy} />
      <FlashMessage />
      <PageHead title="Documentos" lead="A base que a IA consulta para responder aos corretores. Só entra na consulta o que estiver pronto e ativo." />

      <details className="card disclose" open={openUpload}>
        <summary className="row-between" style={{ padding: "var(--s-5) var(--s-6)" }}>
          <span className="row"><IconUpload size={18} /><b>Adicionar documento</b></span>
          <span className="btn btn-primary btn-sm" aria-hidden="true">Enviar PDF</span>
        </summary>
        <div style={{ padding: "0 var(--s-6) var(--s-6)" }}>
          <ActionForm action={uploadAction} encType="multipart/form-data" ariaLabel="Enviar documento">
            <UploadFields insurers={catalog} docTypes={docTypes} />
            {catalog.length === 0 ? (
              <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
                Dica: <Link href="/admin/catalogo">cadastre as seguradoras</Link> antes para organizar a biblioteca e permitir filtrar a consulta.
              </p>
            ) : null}
            <div className="row">
              <SubmitButton pendingLabel="Enviando…">Enviar documento</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </details>

      <div className="stack">
        <div className="row" style={{ flexWrap: "wrap" }} role="group" aria-label="Filtrar por situação"><div className="seg">
          {FILTERS.map(([k, label]) => (
            <Link key={k} href={k ? `/admin/biblioteca?status=${k}` : "/admin/biblioteca"} className={`btn btn-sm ${(sp.status ?? "") === k ? "btn-secondary" : "btn-ghost"}`} aria-current={(sp.status ?? "") === k ? "page" : undefined}>
              {label}
            </Link>
          ))}
          </div>
          <form role="search" className="row" style={{ marginLeft: "auto", flex: "1 1 240px", maxWidth: 360 }}>
            {sp.status ? <input type="hidden" name="status" value={sp.status} /> : null}
            <label htmlFor="q" className="sr-only">Buscar</label>
            <input id="q" name="q" className="input" defaultValue={sp.q ?? ""} placeholder="Buscar documento" />
          </form>
        </div>

        {docs.length === 0 ? (
          <EmptyState
            title={sp.status || sp.q ? "Nenhum documento com esse filtro" : "Nenhum documento enviado"}
            why={sp.status || sp.q ? "Mude o filtro para ver os demais." : "Envie as condições gerais das seguradoras para que a consulta tenha de onde responder."}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Documento</th>
                  <th scope="col">Situação</th>
                  <th scope="col">Seguradora</th>
                  <th scope="col">Vigência</th>
                  <th scope="col">Citações (30 dias)</th>
                  <th scope="col">Atualizado</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.sourceId} style={d.sourceStatus !== "active" ? { opacity: 0.6 } : undefined}>
                    <td>
                      <Link href={`/admin/biblioteca/${d.sourceId}`}>{d.title}</Link>
                      <div className="meta">
                        {DOC_TYPES[d.docType] ?? d.docType}
                        {d.versionNumber ? ` · versão ${d.versionNumber}` : ""}
                        {d.sourceStatus !== "active" ? " · desativado" : ""}
                      </div>
                    </td>
                    <td>
                      <div className="stack-sm" style={{ gap: 4, alignItems: "flex-start" }}>
                        <DocStatusBadge status={d.status} stage={d.stage} />
                        {d.pendingVersionStatus ? <span className="meta">nova versão: {d.pendingVersionStatus === "failed" ? "falhou" : "processando"}</span> : null}
                        {d.status === "failed" && d.errorMessage ? <span className="meta" style={{ color: "var(--danger)" }}>{d.errorMessage}</span> : null}
                      </div>
                    </td>
                    <td>{[d.insurerName, d.productName].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="meta">{d.validUntil ? `até ${formatDate(d.validUntil)}` : "—"}</td>
                    <td className="meta">{d.citations30d}</td>
                    <td className="meta" style={{ whiteSpace: "nowrap" }}>{formatDateTime(d.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
