import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/app/entrar/AuthFrame";
import { previewInvitation } from "@/lib/domain/members";
import { getCurrentUser } from "@/lib/auth/web";
import { ROLE_LABEL } from "@/lib/authz/policy";
import { formatDate } from "@/ui/components";
import { InviteForms } from "@/app/convite/[token]/InviteForms";

export const metadata: Metadata = { title: "Convite", robots: { index: false } };

export default async function ConvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await previewInvitation(token);
  const user = await getCurrentUser();

  return (
    <AuthFrame>
      <div className="auth-form">
        {invite.state === "valid" ? (
          <>
            <div className="stack-sm">
              <span className="eyebrow"><span className="dot" />Convite</span>
              <h1>Você foi convidado para a {invite.orgName}</h1>
              <p className="muted">
                Papel: <b>{ROLE_LABEL[invite.role]}</b> · e-mail <b>{invite.email}</b> · vale até {formatDate(invite.expiresAt)}.
              </p>
              <p className="muted">
                Na ApoIA Seguro você consulta condições gerais e documentos da corretora com apoio de IA, e cada resposta mostra o trecho de onde veio.
              </p>
            </div>
            <InviteForms
              token={token}
              mode={
                user
                  ? user.email.toLowerCase() === invite.email.toLowerCase()
                    ? "accept"
                    : "wrong-account"
                  : invite.userExists
                    ? "login"
                    : "register"
              }
              loggedEmail={user?.email ?? null}
            />
          </>
        ) : invite.state === "expired" ? (
          <>
            <h1>Este convite venceu</h1>
            <p className="muted">Convites valem por 7 dias. Peça um novo convite a quem administra a {invite.orgName}.</p>
          </>
        ) : invite.state === "accepted" ? (
          <>
            <h1>Convite já utilizado</h1>
            <p className="muted">Este convite para a {invite.orgName} já foi aceito. Entre com seu e-mail e senha.</p>
            <Link className="btn btn-primary" href="/entrar">Entrar</Link>
          </>
        ) : (
          <>
            <h1>Convite não encontrado</h1>
            <p className="muted">Confira se o endereço foi copiado inteiro. Se o problema continuar, peça um novo convite a quem administra a corretora.</p>
          </>
        )}
      </div>
    </AuthFrame>
  );
}
