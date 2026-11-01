"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { loginAction, type FormState } from "@/app/actions/auth";
import { SubmitButton } from "@/ui/client";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState<FormState, FormData>(loginAction, undefined);
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="stack" noValidate>
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" className="input" autoComplete="email" required autoFocus
          aria-invalid={state?.error ? true : undefined} aria-describedby={state?.error ? "login-erro" : undefined} />
      </div>
      <div className="field">
        <div className="row-between">
          <label htmlFor="senha">Senha</label>
          <Link href="/recuperar" style={{ fontSize: "var(--text-sm)" }}>Esqueci minha senha</Link>
        </div>
        <div style={{ position: "relative" }}>
          <input id="senha" name="senha" type={show ? "text" : "password"} className="input" autoComplete="current-password" required
            style={{ paddingRight: 52 }} aria-invalid={state?.error ? true : undefined} />
          <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={show} className="btn btn-ghost btn-sm" style={{ position: "absolute", right: 4, top: 4, minHeight: 36 }}>
            {show ? "Ocultar" : "Mostrar"}
          </button>
        </div>
      </div>
      {state?.error ? (
        <p id="login-erro" className="alert alert-danger" role="alert">{state.error}</p>
      ) : null}
      <SubmitButton className="btn btn-primary btn-lg btn-block" pendingLabel="Entrando…">Entrar</SubmitButton>
    </form>
  );
}
