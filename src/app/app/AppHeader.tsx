import Link from "next/link";
import { requireTenant, getMemberships } from "@/lib/auth/web";
import { can, ROLE_LABEL } from "@/lib/authz/policy";
import { initials } from "@/ui/components";
import { BRAND, Wordmark } from "@/ui/brand";
import { NavTabs } from "@/app/app/NavTabs";
import { logoutAction, switchOrgAction } from "@/app/actions/auth";

/** Cabeçalho comum do aplicativo e da administração. */
export async function AppHeader() {
  const { user, session } = await requireTenant();
  const memberships = await getMemberships(user.userId);
  const current = memberships.find((m) => m.orgId === session.orgId);
  const isAdmin = can(session, "member.manage");

  return (
    <header className="app-header">
        <div className="inner">
          <Link href="/app" className="brandmark" aria-label={`${BRAND.name}: ${current?.orgName ?? ""}, ir para a consulta`}>
            <Wordmark size={19} />
            <span className="sep" aria-hidden="true" />
            <span className="org">{current?.orgName}</span>
          </Link>
          <NavTabs
            items={[
              { href: "/app", label: "Consulta", exact: true },
              { href: "/app/historico", label: "Histórico" },
              { href: "/app/biblioteca", label: "Documentos" },
              ...(isAdmin ? [{ href: "/admin", label: "Administração" }] : []),
            ]}
          />
          <div className="header-end">
            <details className="user-menu">
              <summary aria-label={`Conta de ${user.name}`}>
                <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
              </summary>
              <div className="menu">
                <div className="who">
                  <b style={{ color: "var(--ink)" }}>{user.name}</b>
                  <div className="muted">{user.email}</div>
                  <div className="muted">{ROLE_LABEL[session.role]} · {current?.orgName}</div>
                </div>
                {memberships.length > 1
                  ? memberships
                      .filter((m) => m.orgId !== session.orgId)
                      .map((m) => (
                        <form key={m.orgId} action={switchOrgAction}>
                          <input type="hidden" name="orgId" value={m.orgId} />
                          <button type="submit">Trocar para {m.orgName}</button>
                        </form>
                      ))
                  : null}
                {user.isPlatformAdmin ? <Link href="/plataforma">Painel da plataforma</Link> : null}
                <form action={logoutAction}>
                  <button type="submit">Sair</button>
                </form>
              </div>
            </details>
          </div>
        </div>
      </header>
  );
}
