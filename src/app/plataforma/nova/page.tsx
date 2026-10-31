import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/auth/web";
import { createBrokerageAction } from "@/app/actions/admin";
import { ActionForm } from "@/ui/ActionForm";
import { SubmitButton } from "@/ui/client";
import { PageHead } from "@/ui/components";

export const metadata: Metadata = { title: "Nova corretora · Plataforma" };

export default async function NewBrokeragePage() {
  await requirePlatformAdmin();
  return (
    <div className="stack-lg">
      <PageHead title="Nova corretora" lead="A corretora começa em modo teste. O responsável recebe um convite para informar seu nome e criar a senha." />
      <section className="card card-pad">
        <ActionForm action={createBrokerageAction} resetOnSuccess ariaLabel="Criar corretora">
          <div className="form-grid">
            <div className="field"><label htmlFor="nome">Nome da corretora</label><input id="nome" name="nome" required minLength={2} maxLength={160} className="input" /></div>
            <div className="field"><label htmlFor="email">E-mail do responsável</label><input id="email" name="email" type="email" required maxLength={254} className="input" /></div>
            <div className="field span-all"><label htmlFor="seguradoras">Seguradoras (opcional)</label><textarea id="seguradoras" name="seguradoras" className="textarea" rows={3} aria-describedby="seguradoras-ajuda" /><span className="help" id="seguradoras-ajuda">Uma por linha. A corretora pode completar o catálogo depois.</span></div>
          </div>
          <label className="check"><input type="checkbox" name="implantador" /><span>Participar como administrador para ajudar na implantação. Isso concede acesso aos dados desta corretora.</span></label>
          <div><SubmitButton pendingLabel="Criando…">Criar corretora</SubmitButton></div>
        </ActionForm>
      </section>
    </div>
  );
}
