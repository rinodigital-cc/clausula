import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth/web";
import { ACCESS_STATE_LABEL, accessState, listBrokerages, type AccessState } from "@/lib/domain/platform";
import { brokerageStatusAction, refreshDeliveriesAction, reissueOwnerAction, retryProcessingAction } from "@/app/actions/admin";
import { ActionForm } from "@/ui/ActionForm";
import { SubmitButton } from "@/ui/client";
import { EmptyState, PageHead, formatDate, formatDateTime } from "@/ui/components";
import { FlashMessage } from "@/ui/flash";

export const metadata: Metadata = { title: "Corretoras · Plataforma" };
const STATUS: Record<string, string> = { trial: "Em teste", active: "Ativa", suspended: "Suspensa", cancelled: "Cancelada" };
const ACCESS_TONE: Record<AccessState, string> = {
  active: "badge-success", delivered: "badge-info", sent: "badge-info", awaiting_send: "badge-neutral", not_sent: "badge-warn",
  expired: "badge-warn", failed: "badge-danger", no_invite: "badge-neutral",
};

export default async function BrokeragesPage() {
  const actor = await requirePlatformAdmin();
  const brokerages = await listBrokerages(actor);
  return (
    <div className="stack-lg">
      <FlashMessage />
      <PageHead title="Corretoras" lead="Acompanhe os acessos e convites. O painel não dá acesso ao conteúdo dos documentos ou das consultas.">
        <form action={refreshDeliveriesAction}><SubmitButton className="btn btn-secondary">Atualizar envios</SubmitButton></form>
        <form action={retryProcessingAction}><SubmitButton className="btn btn-secondary">Retomar processamento</SubmitButton></form>
        <Link className="btn btn-primary" href="/plataforma/nova">Nova corretora</Link>
      </PageHead>
      {!brokerages.length ? <EmptyState title="Nenhuma corretora criada" why="Crie a primeira corretora e envie o convite ao responsável." /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Corretora</th><th scope="col">Responsável e acesso</th><th scope="col">Situação</th><th scope="col">Acessos e documentos</th><th scope="col">Ações</th></tr></thead>
            <tbody>{brokerages.map((b) => {
              const state = accessState(b);
              return (
              <tr key={b.id}>
                <td><Link href={`/plataforma/corretoras/${b.id}`}><b>{b.name}</b></Link><div className="meta">Criada em {formatDate(b.createdAt)}</div></td>
                <td>
                  <div>{b.ownerEmail ?? b.ownerPending ?? "Sem responsável"}</div>
                  <span className={`badge ${ACCESS_TONE[state]}`}>{ACCESS_STATE_LABEL[state]}</span>
                  {state !== "active" && b.emailCreatedAt ? (
                    <div className="meta">Último envio {formatDateTime(b.emailSentAt ?? b.emailCreatedAt)}{b.emailAttempts && b.emailAttempts > 1 ? ` · ${b.emailAttempts} tentativas` : ""}</div>
                  ) : null}
                  {state === "failed" && b.emailError ? <div className="meta">{b.emailError}</div> : null}
                </td>
                <td><span className={`badge ${b.status === "suspended" ? "badge-warn" : "badge-neutral"}`}>{STATUS[b.status] ?? b.status}</span></td>
                <td><div>{b.members} com acesso · {b.pendingInvites} convites pendentes</div><div className="meta">{b.docsReady} documentos prontos · {b.docsProcessing} processando · {b.docsFailed} falharam</div></td>
                <td>
                  <div className="stack-sm">
                    {b.status !== "cancelled" ? (
                      <form action={brokerageStatusAction} aria-label={`Alterar situação de ${b.name}`}>
                        <input type="hidden" name="corretora" value={b.id} />
                        <input type="hidden" name="situacao" value={b.status === "suspended" ? "active" : "suspended"} />
                        <SubmitButton className="btn btn-secondary btn-sm">{b.status === "suspended" ? "Reativar" : "Suspender"}</SubmitButton>
                      </form>
                    ) : null}
                    {!b.ownerEmail && b.status !== "cancelled" ? (
                      <details className="disclose">
                        <summary className="btn btn-ghost btn-sm">{state === "expired" ? "Enviar novo convite" : "Reenviar convite"}</summary>
                        <ActionForm action={reissueOwnerAction} ariaLabel={`Reenviar convite de ${b.name}`}>
                          <input type="hidden" name="corretora" value={b.id} />
                          <div className="field">
                            <label htmlFor={`email-${b.id}`}>E-mail do responsável</label>
                            <input id={`email-${b.id}`} name="email" type="email" required className="input" defaultValue={b.ownerPending ?? ""} />
                          </div>
                          <SubmitButton className="btn btn-secondary btn-sm">Enviar novo convite</SubmitButton>
                        </ActionForm>
                      </details>
                    ) : null}
                    <Link className="btn btn-ghost btn-sm" href={`/plataforma/corretoras/${b.id}`}>Histórico</Link>
                  </div>
                </td>
              </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
