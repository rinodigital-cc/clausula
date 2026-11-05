import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/app/entrar/AuthFrame";
import { RecoverForm } from "@/app/recuperar/RecoverForm";

export const metadata: Metadata = { title: "Recuperar acesso", robots: { index: false } };

export default async function RecuperarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { invalido } = await searchParams;
  return (
    <AuthFrame>
      <div className="auth-form">
        <div className="stack-sm">
          <h1>Recuperar acesso</h1>
          <p className="muted">Informe seu e-mail. Se houver uma conta, enviaremos um link para criar uma nova senha.</p>
        </div>
        {invalido ? <p className="alert alert-danger" role="alert">Link inválido ou expirado. Solicite um novo link e abra-o no mesmo navegador.</p> : null}
        <RecoverForm />
        <Link href="/entrar">Voltar para entrar</Link>
      </div>
    </AuthFrame>
  );
}
