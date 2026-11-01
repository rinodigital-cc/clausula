"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { askAction, type AskState } from "@/app/actions/consult";
import { IconArrowRight, IconSearch } from "@/ui/icons";

const STEPS = [
  "Procurando nos documentos da corretora…",
  "Conferindo os trechos encontrados…",
  "Separando exclusões, carências e condições…",
  "Montando a resposta com as fontes…",
];

function PendingSteps() {
  const { pending } = useFormStatus();
  return pending ? <PendingTimeline /> : null;
}

function PendingTimeline() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(x + 1, STEPS.length - 1)), 1400);
    return () => clearInterval(t);
  }, []);
  return (
    <p className="step-status" role="status" aria-live="polite">
      <span className="spinner" style={{ color: "var(--accent)" }} aria-hidden="true" />
      {STEPS[i]}
    </p>
  );
}

function AskButton({ compact }: { compact?: boolean }) {
  const { pending } = useFormStatus();
  if (compact) {
    return (
      <button type="submit" className="btn btn-primary btn-icon" disabled={pending} aria-disabled={pending} aria-label={pending ? "Consultando" : "Perguntar"}>
        {pending ? <span className="spinner" aria-hidden="true" /> : <IconArrowRight size={18} />}
      </button>
    );
  }
  return (
    <button type="submit" className="btn btn-primary" disabled={pending} aria-disabled={pending} style={{ minWidth: 132, minHeight: 50 }}>
      {pending ? <span className="spinner" aria-hidden="true" /> : null}
      {pending ? "Consultando" : "Perguntar"}
      {pending ? null : <IconArrowRight size={17} />}
    </button>
  );
}

export function AskForm({
  conversationId,
  insurers,
  suggestions = [],
  autoFocus = false,
  compact = false,
  placeholder = "Ex.: o residencial cobre queima de aparelho por oscilação de energia?",
}: {
  conversationId?: string;
  insurers: { id: string; name: string }[];
  suggestions?: string[];
  autoFocus?: boolean;
  compact?: boolean;
  placeholder?: string;
}) {
  const [state, action] = useActionState<AskState, FormData>(askAction, undefined);
  const [q, setQ] = useState(state?.question ?? "");
  const input = useRef<HTMLInputElement>(null);

  // Atalho "/" foca o campo de pergunta (exceto quando já se está digitando)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form action={action} className="stack" style={{ gap: "var(--s-3)" }}>
      {conversationId ? <input type="hidden" name="conversa" value={conversationId} /> : null}
      <div className={compact ? "ask-bar" : "ask-bar lg"}>
        <IconSearch />
        <label htmlFor="pergunta" className="sr-only">Sua pergunta</label>
        <input
          ref={input}
          id="pergunta"
          name="pergunta"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          maxLength={1000}
          required
          minLength={3}
          autoFocus={autoFocus}
          aria-invalid={state?.error ? true : undefined}
          aria-describedby={state?.error ? "pergunta-erro" : undefined}
        />
        {insurers.length > 1 ? (
          <>
            <label htmlFor="seguradora" className="sr-only">Seguradora</label>
            <select id="seguradora" name="seguradora" defaultValue="">
              <option value="">Todas as seguradoras</option>
              {insurers.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </>
        ) : null}
        <AskButton compact={compact} />
      </div>
      <PendingSteps />
      {state?.error ? (
        <p id="pergunta-erro" className="alert alert-danger" role="alert">{state.error}</p>
      ) : null}
      {suggestions.length > 0 && !q ? (
        <div className="stack-sm">
          <span className="muted" style={{ fontSize: "var(--text-sm)", paddingLeft: 4 }}>Sugestões a partir dos documentos da corretora</span>
          <div className="suggestions">
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => { setQ(s); input.current?.focus(); }}>{s}</button>
            ))}
          </div>
        </div>
      ) : null}
    </form>
  );
}
