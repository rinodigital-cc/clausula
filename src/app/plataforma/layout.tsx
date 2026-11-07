import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth/web";
import { logoutAction } from "@/app/actions/auth";
import { SideNav } from "@/app/app/NavTabs";
import { Wordmark } from "@/ui/brand";
import { IconHome, IconUsers } from "@/ui/icons";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePlatformAdmin();
  return (
    <>
      <header className="app-header">
        <div className="inner">
          <Link href="/plataforma" className="brandmark" aria-label="ApoIA Seguro: painel da plataforma"><Wordmark size={19} /></Link>
          <div className="header-end">
            <span>{user.name}</span>
            {user.activeOrgId ? <Link className="btn btn-ghost btn-sm" href="/app">Abrir corretora</Link> : null}
            <form action={logoutAction}><button className="btn btn-ghost btn-sm" type="submit">Sair</button></form>
          </div>
        </div>
      </header>
      <div className="admin-shell" id="conteudo">
        <aside className="admin-side">
          <SideNav items={[
            { href: "/plataforma", label: "Corretoras", icon: <IconHome size={18} />, exact: true },
            { href: "/plataforma/interessados", label: "Interessados", icon: <IconUsers size={18} /> },
          ]} />
        </aside>
        <main className="admin-main">{children}</main>
      </div>
    </>
  );
}
