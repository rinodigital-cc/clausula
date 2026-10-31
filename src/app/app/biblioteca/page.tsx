import type { Metadata } from "next";
import Link from "next/link";
import { requireTenant } from "@/lib/auth/web";
import { DOC_TYPES, listDocuments } from "@/lib/domain/documents";
import { knowledgeOverview } from "@/lib/domain/consult";
import { can } from "@/lib/authz/policy";
import { EmptyState, PageHead, formatDate } from "@/ui/components";

export const metadata: Metadata = { title: "Documentos" };

export default async function BibliotecaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { session } = await requireTenant("library.browse");
  const [overview, docs] = await Promise.all([
    knowledgeOverview(session),
    listDocuments(session, { q: sp.q, insurerId: sp.seguradora || undefined }),
  ]);
  // O corretor vê apenas documentos prontos (a própria consulta aplica o mesmo filtro).
  const ready = docs.filter((d) => d.status === "ready" || d.status === "ready_with_warnings");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="container" style={{ paddingTop: "var(--s-8)", paddingBottom: "var(--s-16)" }}>
      <div className="stack-lg">
        <PageHead title="Documentos" lead="A base que a IA consulta para responder. Nada fora desta lista entra nas respostas.">
          {can(session, "source.write") ? <Link className="btn btn-secondary" href="/admin/biblioteca">Gerenciar documentos</Link> : null}
        </PageHead>

        <form className="row" role="search" style={{ flexWrap: "wrap" }}>
          <label htmlFor="q" className="sr-only">Buscar documento</label>
          <input id="q" name="q" className="input" defaultValue={sp.q ?? ""} placeholder="Buscar por nome, seguradora ou produto" style={{ flex: "1 1 260px" }} />
          {overview.insurers.length > 1 ? (
            <>
              <label htmlFor="seguradora" className="sr-only">Seguradora</label>
              <select id="seguradora" name="seguradora" className="select" defaultValue={sp.seguradora ?? ""} style={{ flex: "0 1 220px" }}>
                <option value="">Todas as seguradoras</option>
                {overview.insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </>
          ) : null}
          <button className="btn btn-secondary">Filtrar</button>
        </form>

        {ready.length === 0 ? (
          <EmptyState
            title={sp.q || sp.seguradora ? "Nenhum documento com esse filtro" : "Ainda não há documentos prontos"}
            why={
              sp.q || sp.seguradora
                ? "Limpe a busca para ver todos os documentos."
                : "Quando a administração da corretora enviar e processar documentos, eles aparecem aqui."
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Documento</th>
                  <th scope="col">Seguradora · produto</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Vigência</th>
                  <th scope="col">Páginas</th>
                </tr>
              </thead>
              <tbody>
                {ready.map((d) => {
                  const expired = d.validUntil && d.validUntil < today;
                  return (
                    <tr key={d.sourceId}>
                      <td>
                        {d.versionId ? <Link href={`/app/documento/${d.versionId}`}>{d.title}</Link> : d.title}
                        {d.versionNumber && d.versionNumber > 1 ? <span className="meta"> · versão {d.versionNumber}</span> : null}
                      </td>
                      <td>{[d.insurerName, d.productName].filter(Boolean).join(" · ") || "—"}</td>
                      <td>{DOC_TYPES[d.docType] ?? d.docType}</td>
                      <td>
                        {d.validUntil ? (
                          expired ? <span className="badge badge-warn">Vencida em {formatDate(d.validUntil)}</span> : `até ${formatDate(d.validUntil)}`
                        ) : (
                          <span className="meta">não informada</span>
                        )}
                      </td>
                      <td className="meta">{d.pageCount ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
