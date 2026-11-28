import type { Metadata } from "next";
import { requireTenant } from "@/lib/auth/web";
import { LINES, listCatalog } from "@/lib/domain/catalog";
import { createInsurerAction, createProductAction } from "@/app/actions/admin";
import { ActionForm } from "@/ui/ActionForm";
import { SubmitButton } from "@/ui/client";
import { EmptyState, PageHead } from "@/ui/components";

export const metadata: Metadata = { title: "Seguradoras e produtos · Administração" };

export default async function CatalogoPage() {
  const { session } = await requireTenant("catalog.manage");
  const catalog = await listCatalog(session);

  return (
    <div className="stack-lg">
      <PageHead title="Seguradoras e produtos" lead="Organizam os documentos e permitem que o corretor filtre a consulta por seguradora." />

      <div className="form-grid" style={{ alignItems: "start" }}>
        <section className="card card-pad stack" aria-labelledby="nova-seg">
          <h2 id="nova-seg" style={{ fontSize: "var(--text-md)" }}>Nova seguradora</h2>
          <ActionForm action={createInsurerAction} resetOnSuccess className="stack-sm">
            <div className="field">
              <label htmlFor="nome-seg">Nome</label>
              <input id="nome-seg" name="nome" className="input" required minLength={2} maxLength={120} />
            </div>
            <div className="row"><SubmitButton className="btn btn-secondary">Adicionar</SubmitButton></div>
          </ActionForm>
        </section>

        {catalog.length > 0 ? (
          <section className="card card-pad stack" aria-labelledby="novo-prod">
            <h2 id="novo-prod" style={{ fontSize: "var(--text-md)" }}>Novo produto</h2>
            <ActionForm action={createProductAction} resetOnSuccess className="stack-sm">
              <div className="field">
                <label htmlFor="seg-prod">Seguradora</label>
                <select id="seg-prod" name="seguradora" className="select" required>
                  {catalog.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="nome-prod">Nome do produto</label>
                <input id="nome-prod" name="nome" className="input" required minLength={2} maxLength={120} />
              </div>
              <div className="field">
                <label htmlFor="ramo">Ramo</label>
                <select id="ramo" name="ramo" className="select" defaultValue="automovel">
                  {Object.entries(LINES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="row"><SubmitButton className="btn btn-secondary">Adicionar</SubmitButton></div>
            </ActionForm>
          </section>
        ) : null}
      </div>

      {catalog.length === 0 ? (
        <EmptyState title="Nenhuma seguradora cadastrada" why="Cadastre as seguradoras com que a corretora trabalha. Depois, ao enviar um documento, você escolhe a qual delas ele pertence." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Seguradora</th><th scope="col">Produtos</th></tr></thead>
            <tbody>
              {catalog.map((i) => (
                <tr key={i.id}>
                  <td><b style={{ fontWeight: 500 }}>{i.name}</b></td>
                  <td>
                    {i.products.length ? (
                      i.products.map((p) => <span key={p.id} className="badge badge-neutral" style={{ marginRight: 6, marginBottom: 4 }}>{p.name} · {LINES[p.line] ?? p.line}</span>)
                    ) : (
                      <span className="meta">nenhum produto</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
