import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/auth/web";
import { listLeads } from "@/lib/domain/platform";
import { leadStatusAction } from "@/app/actions/admin";
import { SubmitButton } from "@/ui/client";
import { EmptyState, PageHead, formatDateTime } from "@/ui/components";
import { FlashMessage } from "@/ui/flash";

export const metadata: Metadata = { title: "Interessados · Plataforma" };
const STATUS = { new: "Novo", contacted: "Contato feito", qualified: "Qualificado", discarded: "Descartado" };

export default async function LeadsPage() {
  const actor = await requirePlatformAdmin();
  const leads = await listLeads(actor);
  return (
    <div className="stack-lg">
      <FlashMessage />
      <PageHead title="Interessados" lead="Os 200 contatos mais recentes enviados pelo site, com autorização para contato." />
      {!leads.length ? <EmptyState title="Nenhum contato recebido" why="Os envios do formulário do site aparecerão aqui." /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th scope="col">Contato</th><th scope="col">Interesse</th><th scope="col">Recebido em</th><th scope="col">Situação</th></tr></thead>
          <tbody>{leads.map((lead) => (
            <tr key={lead.id}>
              <td><b>{lead.name}</b><div>{lead.email}</div><div className="meta">{[lead.company, lead.phone, lead.teamSize ? `${lead.teamSize} pessoas` : null].filter(Boolean).join(" · ")}</div></td>
              <td>{lead.interest}{lead.message ? <p>{lead.message}</p> : null}</td>
              <td className="meta">{formatDateTime(lead.createdAt)}</td>
              <td><form action={leadStatusAction} className="stack-sm" aria-label={`Situação de ${lead.name}`}>
                <input type="hidden" name="interessado" value={lead.id} />
                <label htmlFor={`situacao-${lead.id}`} className="sr-only">Situação de {lead.name}</label>
                <select id={`situacao-${lead.id}`} name="situacao" className="select" defaultValue={lead.status}>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                <SubmitButton className="btn btn-secondary btn-sm">Salvar situação</SubmitButton>
              </form></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
