import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/app/entrar/AuthFrame";
import { checkResetToken } from "@/lib/domain/account";
import { PasswordForm } from "@/app/redefinir/[token]/PasswordForm";

export const metadata: Metadata = { title: "Criar senha", robots: { index: false } };

export default async function RedefinirPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = await checkResetToken(token);
  return (
    <AuthFrame>
      <div className="auth-form">
        {valid ? (
          <>
            <div className="stack-sm">
              <h1>Criar nova senha</h1>
              <p className="muted">Use pelo menos 10 caracteres, misturando letras e números. Ao salvar, as outras sessões abertas são encerradas.</p>
            </div>
            <PasswordForm token={token} />
          </>
        ) : (
          <>
            <h1>Link inválido ou expirado</h1>
            <p className="muted">Links de senha valem por 1 hora e só podem ser usados uma vez. Peça um novo.</p>
            <Link className="btn btn-primary" href="/recuperar">Pedir novo link</Link>
          </>
        )}
      </div>
    </AuthFrame>
  );
}
