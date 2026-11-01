import type { Metadata } from "next";
import { requireTenant } from "@/lib/auth/web";
import { listMembers, listPendingInvites } from "@/lib/domain/members";
import { canRemoveMember, ROLE_LABEL } from "@/lib/authz/policy";
import { changeRoleAction, inviteAction, removeMemberAction, revokeInviteAction } from "@/app/actions/admin";
import { ActionForm } from "@/ui/ActionForm";
import { SubmitButton } from "@/ui/client";
import { PageHead, formatDate, formatDateTime, initials } from "@/ui/components";
import { FlashMessage } from "@/ui/flash";

export const metadata: Metadata = { title: "Equipe · Administração" };

export default async function EquipePage() {
  const { session } = await requireTenant("member.manage");
  const [members, invites] = await Promise.all([listMembers(session), listPendingInvites(session)]);
  const active = members.filter((m) => m.status === "active");
  const pending = invites.filter((i) => !i.expired);

  return (
    <div className="stack-lg">
      <FlashMessage />
      <PageHead title="Equipe" lead="Quem pode consultar e quem administra. Cada pessoa vê apenas os dados desta corretora." />

      <section className="card card-pad stack" aria-labelledby="convidar">
        <h2 id="convidar" style={{ fontSize: "var(--text-lg)" }}>Convidar pessoa</h2>
        <ActionForm action={inviteAction} resetOnSuccess ariaLabel="Convidar pessoa">
          <div className="form-grid">
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label htmlFor="email">E-mail</label>
              <input id="email" name="email" type="email" required autoComplete="off" className="input" placeholder="nome@corretora.com.br" />
            </div>
            <div className="field">
              <label htmlFor="papel">Papel</label>
              <select id="papel" name="papel" className="select" defaultValue="member" aria-describedby="papel-ajuda">
                <option value="member">{ROLE_LABEL.member}</option>
                <option value="admin">{ROLE_LABEL.admin}</option>
              </select>
            </div>
          </div>
          <p id="papel-ajuda" className="muted" style={{ fontSize: "var(--text-sm)" }}>
            <b>Corretor</b> consulta e vê o próprio histórico. <b>Administrador</b> também cuida dos documentos, da equipe e das perguntas sem resposta.
          </p>
          <div className="row"><SubmitButton pendingLabel="Criando convite…">Criar convite</SubmitButton></div>
        </ActionForm>
      </section>

      {pending.length > 0 ? (
        <section className="stack" aria-labelledby="pendentes">
          <h2 id="pendentes" style={{ fontSize: "var(--text-lg)" }}>Convites pendentes</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th scope="col">E-mail</th><th scope="col">Papel</th><th scope="col">Vale até</th><th scope="col"><span className="sr-only">Ações</span></th></tr>
              </thead>
              <tbody>
                {pending.map((i) => (
                  <tr key={i.id}>
                    <td>{i.email}</td>
                    <td>{ROLE_LABEL[i.role]}</td>
                    <td className="meta">{formatDate(i.expiresAt)}</td>
                    <td style={{ textAlign: "right" }}>
                      <form action={revokeInviteAction} className="inline-form">
                        <input type="hidden" name="convite" value={i.id} />
                        <SubmitButton className="btn btn-ghost btn-sm">Cancelar convite</SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
            Por segurança, o link de um convite só aparece no momento em que ele é criado. Se a pessoa perdeu o link, crie o convite de novo: o anterior deixa de valer.
          </p>
        </section>
      ) : null}

      <section className="stack" aria-labelledby="membros">
        <h2 id="membros" style={{ fontSize: "var(--text-lg)" }}>Pessoas com acesso ({active.length})</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th scope="col">Pessoa</th><th scope="col">Papel</th><th scope="col">Último acesso</th><th scope="col"><span className="sr-only">Ações</span></th></tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const self = m.userId === session.userId;
                const removable = m.status === "active" && !self && canRemoveMember(session, { userId: m.userId, role: m.role }).allowed;
                return (
                  <tr key={m.userId} style={m.status !== "active" ? { opacity: 0.55 } : undefined}>
                    <td>
                      <div className="row">
                        <span className="avatar" aria-hidden="true">{initials(m.name)}</span>
                        <span className="stack-sm" style={{ gap: 0 }}>
                          <b style={{ fontWeight: 500 }}>{m.name}{self ? " (você)" : ""}</b>
                          <span className="meta">{m.email}{m.status !== "active" ? " · sem acesso" : ""}</span>
                        </span>
                      </div>
                    </td>
                    <td>
                      {m.role === "owner" || self || m.status !== "active" ? (
                        ROLE_LABEL[m.role]
                      ) : (
                        <form action={changeRoleAction} className="inline-form">
                          <input type="hidden" name="usuario" value={m.userId} />
                          <label htmlFor={`papel-${m.userId}`} className="sr-only">Papel de {m.name}</label>
                          <select id={`papel-${m.userId}`} name="papel" className="select" defaultValue={m.role} style={{ minHeight: 36, width: "auto" }}>
                            <option value="member">{ROLE_LABEL.member}</option>
                            <option value="admin">{ROLE_LABEL.admin}</option>
                          </select>
                          <SubmitButton className="btn btn-ghost btn-sm">Salvar</SubmitButton>
                        </form>
                      )}
                    </td>
                    <td className="meta">{m.lastSeenAt ? formatDateTime(m.lastSeenAt) : "nunca"}</td>
                    <td style={{ textAlign: "right" }}>
                      {removable ? (
                        <details className="disclose" style={{ display: "inline-block", textAlign: "left" }}>
                          <summary className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }}>Remover</summary>
                          <form action={removeMemberAction} className="stack-sm danger-zone" style={{ marginTop: 8, maxWidth: 300 }}>
                            <input type="hidden" name="usuario" value={m.userId} />
                            <p style={{ fontSize: "var(--text-sm)" }}>{m.name} perde o acesso na hora. O histórico de consultas é mantido.</p>
                            <label htmlFor={`conf-${m.userId}`} style={{ fontSize: "var(--text-sm)" }}>Digite REMOVER para confirmar</label>
                            <input id={`conf-${m.userId}`} name="confirmar" className="input" autoComplete="off" required pattern="REMOVER" />
                            <SubmitButton className="btn btn-danger btn-sm">Remover acesso</SubmitButton>
                          </form>
                        </details>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
