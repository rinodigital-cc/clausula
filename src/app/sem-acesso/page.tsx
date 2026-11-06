import type { Metadata } from "next";
import { getCurrentUser, getMemberships } from "@/lib/auth/web";
import { redirect } from "next/navigation";
import { logoutAction, switchOrgAction } from "@/app/actions/auth";
import { AuthFrame } from "@/app/entrar/AuthFrame";

export const metadata: Metadata = { title: "Sem acesso ativo" };

export default async function SemAcessoPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");
  const memberships = (await getMemberships(user.userId)).filter((m) => m.orgStatus === "active");

  return (
    <AuthFrame>
      <div className="stack">
        <h1 style={{ fontSize: "var(--text-2xl)" }}>Você não tem uma corretora ativa</h1>
        <p className="muted">
          Seu acesso existe, mas não está ligado a uma corretora ativa no momento. Isso acontece quando o vínculo foi encerrado
          ou a corretora foi suspensa. Fale com a administração da sua corretora.
        </p>
        {memberships.length > 0 ? (
          <div className="stack-sm">
            <p>Você ainda participa de:</p>
            {memberships.map((m) => (
              <form key={m.orgId} action={switchOrgAction}>
                <input type="hidden" name="orgId" value={m.orgId} />
                <button className="btn btn-secondary btn-block">Entrar em {m.orgName}</button>
              </form>
            ))}
          </div>
        ) : null}
        <form action={logoutAction}>
          <button className="btn btn-ghost">Sair</button>
        </form>
      </div>
    </AuthFrame>
  );
}
