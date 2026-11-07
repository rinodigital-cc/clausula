"use client";

import Link from "next/link";
import { useActionState } from "react";
import { acceptLoggedInAction, registerInviteAction, type FormState } from "@/app/actions/auth";
import { SubmitButton } from "@/ui/client";

export function InviteForms({
  token,
  mode,
  loggedEmail,
}: {
  token: string;
  mode: "register" | "login" | "accept" | "wrong-account";
  loggedEmail: string | null;
}) {
  const [regState, register] = useActionState<FormState, FormData>(registerInviteAction, undefined);
  const [accState, accept] = useActionState<FormState, FormData>(acceptLoggedInAction, undefined);

  if (mode === "accept") {
    return (
      <form action={accept} className="stack">
        <input type="hidden" name="token" value={token} />
        {accState?.error ? <p className="alert alert-danger" role="alert">{accState.error}</p> : null}
        <SubmitButton className="btn btn-primary btn-lg btn-block" pendingLabel="Aceitando…">Aceitar convite</SubmitButton>
      </form>
    );
  }
  if (mode === "wrong-account") {
    return (
      <p className="alert alert-warn" role="status">
        Você está conectado como {loggedEmail}, mas o convite é para outro e-mail. Saia da conta atual e abra o link de novo.
      </p>
    );
  }
  if (mode === "login") {
    return (
      <div className="stack">
        <p className="muted">Já existe uma conta com este e-mail. Entre com sua senha para aceitar o convite.</p>
        <Link className="btn btn-primary btn-lg" href={`/entrar?next=${encodeURIComponent(`/convite/${token}`)}`}>Entrar para aceitar</Link>
      </div>
    );
  }
  return (
    <form action={register} className="stack">
      <input type="hidden" name="token" value={token} />
      <div className="field">
        <label htmlFor="nome">Seu nome completo</label>
        <input id="nome" name="nome" className="input" autoComplete="name" required minLength={2} autoFocus />
      </div>
      <div className="field">
        <label htmlFor="senha">Crie uma senha</label>
        <input id="senha" name="senha" type="password" className="input" autoComplete="new-password" minLength={10} required aria-describedby="senha-ajuda" />
        <span id="senha-ajuda" className="help">Mínimo de 10 caracteres, com letras e números. Ninguém da ApoIA Seguro pede sua senha.</span>
      </div>
      <div className="field">
        <label htmlFor="confirmacao">Confirme a senha</label>
        <input id="confirmacao" name="confirmacao" type="password" className="input" autoComplete="new-password" required />
      </div>
      {regState?.error ? <p className="alert alert-danger" role="alert">{regState.error}</p> : null}
      <SubmitButton className="btn btn-primary btn-lg btn-block" pendingLabel="Criando acesso…">Criar acesso e entrar</SubmitButton>
    </form>
  );
}
