"use client";

import { useActionState } from "react";
import { resetAction, type FormState } from "@/app/actions/auth";
import { SubmitButton } from "@/ui/client";

export function PasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState<FormState, FormData>(resetAction, undefined);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="token" value={token} />
      <div className="field">
        <label htmlFor="senha">Nova senha</label>
        <input id="senha" name="senha" type="password" className="input" autoComplete="new-password" minLength={10} required autoFocus
          aria-describedby="senha-ajuda" />
        <span id="senha-ajuda" className="help">Mínimo de 10 caracteres, com letras e números.</span>
      </div>
      <div className="field">
        <label htmlFor="confirmacao">Confirme a senha</label>
        <input id="confirmacao" name="confirmacao" type="password" className="input" autoComplete="new-password" required />
      </div>
      {state?.error ? <p className="alert alert-danger" role="alert">{state.error}</p> : null}
      <SubmitButton className="btn btn-primary btn-lg btn-block" pendingLabel="Salvando…">Salvar e entrar</SubmitButton>
    </form>
  );
}
