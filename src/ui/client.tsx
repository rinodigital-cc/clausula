"use client";

import { useFormStatus } from "react-dom";
import { useState } from "react";
import { IconCheck, IconCopy } from "@/ui/icons";

/** Botão de envio: desabilita e mostra progresso SEM mudar de largura. */
export function SubmitButton({
  children,
  pendingLabel,
  className = "btn btn-primary",
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-disabled={pending} name={name} value={value}>
      {pending ? <span className="spinner" aria-hidden="true" /> : null}
      <span>{pending && pendingLabel ? pendingLabel : children}</span>
    </button>
  );
}

/** Copiar para a área de transferência, com retorno visível e anunciado. */
export function CopyButton({ text, label = "Copiar", className = "btn btn-secondary btn-sm" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2500);
        } catch {
          window.prompt("Copie o texto:", text);
        }
      }}
    >
      {done ? <IconCheck size={16} /> : <IconCopy size={16} />}
      <span aria-live="polite">{done ? "Copiado" : label}</span>
    </button>
  );
}
