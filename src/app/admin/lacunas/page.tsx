import type { Metadata } from "next";
import Link from "next/link";
import { requireTenant } from "@/lib/auth/web";
import { listGaps } from "@/lib/domain/gaps";
import { listCatalog } from "@/lib/domain/catalog";
import { dismissGapAction, resolveGapAction } from "@/app/actions/admin";
import { ActionForm } from "@/ui/ActionForm";
import { SubmitButton } from "@/ui/client";
import { EmptyState, PageHead, formatDateTime } from "@/ui/components";
import { FlashMessage } from "@/ui/flash";

export const metadata: Metadata = { title: "Perguntas sem resposta · Administração" };

const TABS: [string, string][] = [["open", "Abertas"], ["resolved", "Resolvidas"], ["dismissed", "Descartadas"]];

export default async function LacunasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const status = (["open", "resolved", "dismissed"].includes(sp.ver ?? "") ? sp.ver : "open") as "open" | "resolved" | "dismissed";
  const { session } = await requireTenant("gap.manage");
  const [gaps, catalog] = await Promise.all([listGaps(session, status), listCatalog(session)]);

  return (
    <div className="stack-lg">
      <FlashMessage />
      <PageHead
        title="Perguntas sem resposta"
        lead="O que os corretores perguntaram e a IA não encontrou nos documentos. Ao responder aqui, você cria um conhecimento interno que passa a ser citado nas consultas, e quem perguntou é avisado."
      />
      <nav className="seg" aria-label="Situação">
        {TABS.map(([k, label]) => (
          <Link key={k} href={k === "open" ? "/admin/lacunas" : `/admin/lacunas?ver=${k}`} className={`btn btn-sm ${status === k ? "btn-secondary" : "btn-ghost"}`} aria-current={status === k ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>

      {gaps.length === 0 ? (
        <EmptyState
          title={status === "open" ? "Nenhuma pergunta pendente" : "Nada por aqui"}
          why={status === "open" ? "Quando a IA não encontrar resposta nos documentos, a pergunta aparece aqui para você completar a base. Lista vazia é bom sinal." : "Ainda não há perguntas nesta situação."}
        />
      ) : (
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {gaps.map((g) => (
            <li key={g.id} className="card card-pad stack">
              <div className="row-between" style={{ alignItems: "flex-start" }}>
                <div className="stack-sm" style={{ gap: 2, flex: "1 1 320px", minWidth: 0 }}>
                  <b style={{ fontSize: "var(--text-md)" }}>{g.question}</b>
                  <span className="meta">
                    {g.askCount} {g.askCount === 1 ? "vez" : "vezes"} · primeira por {g.askedBy ?? "—"} · {formatDateTime(g.createdAt)}
                  </span>
                </div>
                {g.askCount > 1 ? <span className="badge badge-warn">Recorrente</span> : null}
              </div>
              {status === "resolved" && g.resolutionNote ? <p className="muted">Resolvida com: {g.resolutionNote}</p> : null}
              {status === "open" ? (
                <div className="row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
                  <details className="disclose" style={{ flex: "1 1 100%" }}>
                    <summary className="btn btn-primary btn-sm" style={{ display: "inline-flex" }}>Responder</summary>
                    <ActionForm action={resolveGapAction} className="stack" style={{ marginTop: 16 }}>
                      <input type="hidden" name="lacuna" value={g.id} />
                      <div className="form-grid">
                        <div className="field" style={{ gridColumn: "span 2" }}>
                          <label htmlFor={`t-${g.id}`}>Título do conhecimento</label>
                          <input id={`t-${g.id}`} name="titulo" className="input" required minLength={3} maxLength={200} placeholder="Ex.: Prazo de aviso de sinistro — Auto" />
                        </div>
                        <div className="field">
                          <label htmlFor={`s-${g.id}`}>Seguradora</label>
                          <select id={`s-${g.id}`} name="seguradora" className="select" defaultValue="">
                            <option value="">Vale para todas</option>
                            {catalog.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                          </select>
                        </div>
                        <div className="field span-all">
                          <label htmlFor={`r-${g.id}`}>Resposta</label>
                          <textarea id={`r-${g.id}`} name="resposta" className="textarea" rows={5} required minLength={20} maxLength={8000}
                            placeholder="Escreva como explicaria a um corretor. Se vier de um documento, cite qual." aria-describedby={`h-${g.id}`} />
                          <span id={`h-${g.id}`} className="help">Fica identificado nas respostas como “Conhecimento interno” da corretora, não como texto de seguradora.</span>
                        </div>
                      </div>
                      <div className="row"><SubmitButton pendingLabel="Salvando…">Salvar e avisar quem perguntou</SubmitButton></div>
                    </ActionForm>
                  </details>
                  <form action={dismissGapAction}>
                    <input type="hidden" name="lacuna" value={g.id} />
                    <SubmitButton className="btn btn-ghost btn-sm">Descartar</SubmitButton>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
