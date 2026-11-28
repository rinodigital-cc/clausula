"use client";

import { useActionState, useEffect, useRef } from "react";
import { CopyButton } from "@/ui/client";

export type ActionState = { ok?: string; error?: string; link?: string; linkLabel?: string; at?: number } | undefined;

/**
 * Formulário ligado a uma server action que devolve um resultado visível
 * (sucesso, erro ou link para copiar). Funciona sem JavaScript; com JS, o
 * resultado aparece no lugar, sem perder o que foi digitado em caso de erro.
 */
export function ActionForm({
  action,
  children,
  className = "stack",
  resetOnSuccess = false,
  encType,
  ariaLabel,
  style,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  encType?: "multipart/form-data";
  ariaLabel?: string;
  style?: React.CSSProperties;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={ref} action={formAction} className={className} encType={encType} aria-label={ariaLabel} style={style}>
      {children}
      {state?.error ? (
        <p className="alert alert-danger" role="alert" style={{ margin: 0 }}>{state.error}</p>
      ) : null}
      {state?.ok ? (
        <div className="alert alert-success" role="status" style={{ margin: 0 }}>
          <div className="stack-sm" style={{ minWidth: 0, flex: 1 }}>
            <span>{state.ok}</span>
            {state.link ? (
              <>
                <code className="mono" style={{ wordBreak: "break-all", fontSize: "var(--text-xs)" }}>{state.link}</code>
                <div className="row">
                  <CopyButton text={state.link} label={state.linkLabel ?? "Copiar link"} />
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </form>
  );
}
