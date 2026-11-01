import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/app/entrar/AuthFrame";

export const metadata: Metadata = { title: "Sem permissão" };

export default function SemPermissaoPage() {
  return (
    <AuthFrame>
      <div className="stack">
        <h1 style={{ fontSize: "var(--text-2xl)" }}>Esta área não está liberada para você</h1>
        <p className="muted">
          Seu papel na corretora não inclui esta função. Se precisar dela, peça a quem administra a corretora para ajustar seu acesso.
        </p>
        <div className="row">
          <Link className="btn btn-primary" href="/app">Ir para consultas</Link>
        </div>
      </div>
    </AuthFrame>
  );
}
