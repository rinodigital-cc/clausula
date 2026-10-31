import type { Metadata } from "next";
import Link from "next/link";
import { requireTenant } from "@/lib/auth/web";
import { listConversations } from "@/lib/domain/consult";
import { can } from "@/lib/authz/policy";
import { ConfidenceBadge, EmptyState, PageHead, formatDateTime } from "@/ui/components";

export const metadata: Metadata = { title: "Histórico" };

export default async function HistoricoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { session } = await requireTenant("conversation.read.own");
  const canAll = can(session, "conversation.read.org");
  const all = canAll && sp.todas === "1";
  const rows = await listConversations(session, { q: sp.q, all });

  return (
    <main className="container" style={{ paddingTop: "var(--s-8)", paddingBottom: "var(--s-16)" }}>
      <div className="stack-lg">
        <PageHead title="Histórico" lead={all ? "Todas as consultas da corretora, com as fontes usadas em cada resposta." : "Suas consultas, da mais recente para a mais antiga. Cada uma guarda as fontes usadas na resposta."} />
        <form className="row" role="search" style={{ flexWrap: "wrap" }}>
          <label htmlFor="q" className="sr-only">Buscar no histórico</label>
          <input id="q" name="q" className="input" defaultValue={sp.q ?? ""} placeholder="Buscar por uma palavra da pergunta" style={{ flex: "1 1 260px" }} />
          {canAll ? (
            <label className="row" style={{ fontSize: "var(--text-sm)" }}>
              <input type="checkbox" name="todas" value="1" defaultChecked={all} /> Toda a corretora
            </label>
          ) : null}
          <button className="btn btn-secondary">Buscar</button>
        </form>

        {rows.length === 0 ? (
          sp.q ? (
            <EmptyState title="Nada encontrado" why={`Nenhuma consulta com “${sp.q}”. Tente outra palavra.`} />
          ) : (
            <EmptyState title="Nenhuma consulta ainda" why="Suas perguntas ficam guardadas aqui com o trecho e o documento usados em cada resposta, para você voltar quando precisar." action={{ href: "/app", label: "Fazer a primeira consulta" }} />
          )
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Consulta</th>
                  {all ? <th scope="col">Quem perguntou</th> : null}
                  <th scope="col">Resultado</th>
                  <th scope="col">Atualizada</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/app/consulta/${c.id}`}>{c.title}</Link>
                      {c.messages > 1 ? <span className="meta"> · {c.messages} perguntas</span> : null}
                    </td>
                    {all ? <td>{c.authorName}</td> : null}
                    <td>{c.lastConfidence ? <ConfidenceBadge confidence={c.lastConfidence as "strong"} /> : "—"}</td>
                    <td className="meta" style={{ whiteSpace: "nowrap" }}>{formatDateTime(c.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
