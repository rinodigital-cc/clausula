import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth/web";
import { isUuid } from "@/lib/db/client";
import { ACCESS_STATE_LABEL, accessState, brokerageEmailHistory, getBrokerage } from "@/lib/domain/platform";
import { reissueOwnerAction } from "@/app/actions/admin";
import { ActionForm } from "@/ui/ActionForm";
import { SubmitButton } from "@/ui/client";
import { EmptyState, PageHead, formatDateTime } from "@/ui/components";

export const metadata: Metadata = { title: "Corretora · Plataforma" };
export const dynamic = "force-dynamic";

const KIND: Record<string, string> = {
  brokerage_invitation: "Convite do responsável", invitation_resend: "Reenvio de convite", invitation: "Convite de usuário",
  password_reset: "Recuperação de senha", first_access: "Primeiro acesso", welcome: "Boas-vindas",
  password_changed: "Senha alterada", email_confirmation: "Confirmação de e-mail", gap_resolved: "Dúvida respondida",
};
const DISPATCH: Record<string, string> = { pending: "Aguardando envio", sent: "Aceito pelo provedor", failed: "Falha no envio", skipped: "Não enviado (sem provedor)" };
const DELIVERY: Record<string, string> = {
  accepted: "Aguardando confirmação de entrega", delivered: "Entregue", delivery_delayed: "Entrega atrasada",
  bounced: "Devolvido pelo destino", complained: "Marcado como spam", failed: "Falha no envio", suppressed: "Endereço bloqueado pelo provedor",
};

export default async function BrokerageDetail({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePlatformAdmin();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [b, history] = await Promise.all([getBrokerage(actor, id), brokerageEmailHistory(actor, id)]);
  if (!b) notFound();
  const state = accessState(b);

  return (
    <div className="stack-lg">
      <PageHead title={b.name} lead={`Acesso do responsável: ${ACCESS_STATE_LABEL[state]}.`}>
        <Link className="btn btn-secondary" href="/plataforma">Voltar</Link>
      </PageHead>
      <section className="card card-pad stack">
        <dl className="stack-sm" style={{ margin: 0 }}>
          <div><dt className="meta">Responsável</dt><dd style={{ margin: 0 }}>{b.ownerEmail ?? b.ownerPending ?? "Sem responsável"}</dd></div>
          <div><dt className="meta">Usuários com acesso</dt><dd style={{ margin: 0 }}>{b.members} · {b.pendingInvites} convites pendentes</dd></div>
          {b.inviteExpiresAt && state !== "active" ? <div><dt className="meta">Convite vale até</dt><dd style={{ margin: 0 }}>{formatDateTime(b.inviteExpiresAt)}</dd></div> : null}
        </dl>
        {state !== "active" && b.status !== "cancelled" ? (
          <ActionForm action={reissueOwnerAction} ariaLabel={`Enviar novo convite para ${b.name}`}>
            <input type="hidden" name="corretora" value={b.id} />
            <div className="field">
              <label htmlFor="email-reenvio">E-mail do responsável</label>
              <input id="email-reenvio" name="email" type="email" required className="input" defaultValue={b.ownerPending ?? ""} />
              <span className="help">O convite anterior deixa de valer. Limite: um envio a cada 2 minutos e 5 por dia.</span>
            </div>
            <div><SubmitButton className="btn btn-primary">Enviar novo convite</SubmitButton></div>
          </ActionForm>
        ) : null}
      </section>
      <section className="stack">
        <h2 style={{ margin: 0, fontSize: "var(--text-lg)" }}>Histórico de envios</h2>
        {!history.length ? <EmptyState title="Nenhum e-mail registrado" why="Os convites e avisos desta corretora aparecem aqui com o estado real de entrega." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Mensagem</th><th scope="col">Envio</th><th scope="col">Entrega</th><th scope="col">Identificador</th></tr></thead>
              <tbody>{history.map((h) => (
                <tr key={h.id}>
                  <td><b>{KIND[h.kind] ?? h.kind}</b><div className="meta">{h.to} · criado {formatDateTime(h.createdAt)}</div></td>
                  <td>{DISPATCH[h.status] ?? h.status}<div className="meta">{h.attempts} tentativa{h.attempts === 1 ? "" : "s"}{h.sentAt ? ` · ${formatDateTime(h.sentAt)}` : ""}</div>{h.lastError ? <div className="meta">{h.lastError}</div> : null}</td>
                  <td>{h.deliveryStatus ? DELIVERY[h.deliveryStatus] ?? h.deliveryStatus : "—"}{h.deliveredAt ? <div className="meta">{formatDateTime(h.deliveredAt)}</div> : null}</td>
                  <td><code className="mono" style={{ fontSize: "var(--text-xs)", wordBreak: "break-all" }}>{h.providerId ?? "—"}</code></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
