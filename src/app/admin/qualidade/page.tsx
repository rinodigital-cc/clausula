import type { Metadata } from "next";
import Link from "next/link";
import { requireTenant } from "@/lib/auth/web";
import { listNegativeFeedback } from "@/lib/domain/gaps";
import { EmptyState, PageHead, formatDateTime } from "@/ui/components";

export const metadata: Metadata = { title: "Avaliações · Administração" };

const RATING: Record<string, { label: string; cls: string }> = {
  wrong: { label: "Errada", cls: "badge-danger" },
  incomplete: { label: "Incompleta", cls: "badge-warn" },
};

export default async function QualidadePage() {
  const { session } = await requireTenant("conversation.read.org");
  const rows = await listNegativeFeedback(session);

  return (
    <div className="stack-lg">
      <PageHead title="Avaliações" lead="Respostas que os corretores marcaram como erradas ou incompletas. Abra a consulta, confira as fontes usadas e decida se falta um documento ou um conhecimento interno." />
      {rows.length === 0 ? (
        <EmptyState title="Nenhuma avaliação negativa" why="Quando um corretor marcar uma resposta como errada ou incompleta, ela aparece aqui com o comentário." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th scope="col">Pergunta</th><th scope="col">Avaliação</th><th scope="col">Comentário</th><th scope="col">Quem · quando</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/app/consulta/${r.conversationId}`}>{r.question}</Link></td>
                  <td><span className={`badge ${RATING[r.rating]?.cls ?? "badge-neutral"}`}>{RATING[r.rating]?.label ?? r.rating}</span></td>
                  <td>{r.comment ?? <span className="meta">sem comentário</span>}</td>
                  <td className="meta">{r.userName}<br />{formatDateTime(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
