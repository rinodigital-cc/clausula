"use client";

import { useActionState } from "react";
import { requestResetAction, type FormState } from "@/app/actions/auth";
import { SubmitButton } from "@/ui/client";

export function RecoverForm() {
  const [state, action] = useActionState<FormState, FormData>(requestResetAction, undefined);
  if (state?.ok) {
    return <p className="alert alert-success" role="status">{state.message}</p>;
  }
  return (
    <form action={action} className="stack">
      <div className="field">
        <label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" className="input" autoComplete="email" required autoFocus />
      </div>
      <SubmitButton className="btn btn-primary btn-lg btn-block" pendingLabel="Enviando…">Enviar link</SubmitButton>
    </form>
  );
}
