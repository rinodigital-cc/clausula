"use client";

import { useActionState, useEffect, useRef } from "react";
import { leadAction, type LeadState } from "@/app/actions/site";
import { SubmitButton } from "@/ui/client";

export function LeadForm({ consentText, defaultInterest }: { consentText: string; defaultInterest: string }) {
  const [state, action] = useActionState<LeadState, FormData>(leadAction, undefined);
  const startedAt = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (startedAt.current) startedAt.current.value = String(Date.now());
  }, []);
  const err = state?.errors ?? {};

  if (state?.ok) {
    return (
      <div className="alert alert-success" role="status">
        <div>
          <b>Recebemos seu contato.</b> Vamos responder pelo e-mail informado para combinar os próximos passos. Nenhuma cobrança ou
          compromisso é gerado por este envio.
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="stack" noValidate>
      <input ref={startedAt} type="hidden" name="inicio" defaultValue="" />
      {/* Campo invisível: pessoas não preenchem, robôs sim. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label htmlFor="website">Site</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="nome">Seu nome</label>
          <input id="nome" name="nome" className="input" autoComplete="name" required aria-invalid={err.name ? true : undefined} aria-describedby={err.name ? "e-nome" : undefined} />
          {err.name ? <span id="e-nome" className="error">{err.name}</span> : null}
        </div>
        <div className="field">
          <label htmlFor="email">E-mail profissional</label>
          <input id="email" name="email" type="email" className="input" autoComplete="email" required aria-invalid={err.email ? true : undefined} aria-describedby={err.email ? "e-email" : undefined} />
          {err.email ? <span id="e-email" className="error">{err.email}</span> : null}
        </div>
        <div className="field">
          <label htmlFor="corretora">Corretora (opcional)</label>
          <input id="corretora" name="corretora" className="input" autoComplete="organization" />
        </div>
        <div className="field">
          <label htmlFor="telefone">Telefone ou WhatsApp (opcional)</label>
          <input id="telefone" name="telefone" type="tel" className="input" autoComplete="tel" />
        </div>
        <div className="field">
          <label htmlFor="equipe">Pessoas na corretora</label>
          <select id="equipe" name="equipe" className="select" defaultValue="">
            <option value="">Prefiro não dizer</option>
            <option value="1">Só eu</option>
            <option value="2-5">2 a 5</option>
            <option value="6-20">6 a 20</option>
            <option value="21-50">21 a 50</option>
            <option value="50+">Mais de 50</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="interesse">Quero</label>
          <select id="interesse" name="interesse" className="select" defaultValue={defaultInterest}>
            <option value="demonstracao">Ver uma demonstração</option>
            <option value="piloto">Participar do piloto</option>
            <option value="contato">Tirar uma dúvida</option>
          </select>
        </div>
        <div className="field span-all">
          <label htmlFor="mensagem">Mensagem (opcional)</label>
          <textarea id="mensagem" name="mensagem" className="textarea" rows={4} maxLength={2000}
            placeholder="Ex.: com quais seguradoras vocês trabalham e que tipo de dúvida mais aparece no dia a dia." />
        </div>
      </div>
      <label className="check">
        <input type="checkbox" name="consentimento" required aria-invalid={err.consent ? true : undefined} />
        <span>{consentText} Veja a <a href="/privacidade">política de privacidade</a>.</span>
      </label>
      {err.consent ? <span className="error" style={{ color: "var(--danger)", fontSize: "var(--text-sm)" }}>{err.consent}</span> : null}
      {state?.message ? <p className="alert alert-danger" role="alert">{state.message}</p> : null}
      <div className="row">
        <SubmitButton className="btn btn-primary btn-lg" pendingLabel="Enviando…">Enviar</SubmitButton>
      </div>
    </form>
  );
}
