import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/web";
import { AuthFrame } from "@/app/entrar/AuthFrame";
import { LoginForm } from "@/app/entrar/LoginForm";
import { Alert } from "@/ui/components";

export const metadata: Metadata = { title: "Entrar", robots: { index: false } };

export default async function EntrarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect(user.activeOrgId ? "/app" : user.isPlatformAdmin ? "/plataforma" : "/sem-acesso");
  return (
    <AuthFrame>
      <div className="auth-form">
        <div className="stack-sm">
          <h1>Entrar</h1>
          <p className="muted">Acesse a ApoIA Seguro com o e-mail cadastrado pela sua corretora.</p>
        </div>
        {sp.saiu ? <Alert tone="success">Você saiu da sua conta.</Alert> : null}
        {sp.expirou ? <Alert tone="info">Sua sessão terminou. Entre de novo para continuar.</Alert> : null}
        <LoginForm next={sp.next ?? ""} />
        <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
          Recebeu um convite? Abra o link do e-mail para criar seu acesso. Problemas para entrar? Fale com quem administra a corretora na plataforma.
        </p>
      </div>
    </AuthFrame>
  );
}
