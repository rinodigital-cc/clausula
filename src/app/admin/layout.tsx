import { AppHeader } from "@/app/app/AppHeader";
import { SideNav } from "@/app/app/NavTabs";
import { requireTenant } from "@/lib/auth/web";
import { adminOverview } from "@/lib/domain/gaps";
import { IconBook, IconGap, IconHome, IconStar, IconTag, IconUsers } from "@/ui/icons";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { session } = await requireTenant("analytics.read");
  const o = await adminOverview(session);
  return (
    <>
      <AppHeader />
      <div className="admin-shell" id="conteudo">
        <aside className="admin-side">
          <SideNav
            items={[
              { href: "/admin", label: "Visão geral", icon: <IconHome size={18} />, exact: true },
              { href: "/admin/biblioteca", label: "Documentos", icon: <IconBook size={18} />, count: o.failed },
              { href: "/admin/equipe", label: "Equipe", icon: <IconUsers size={18} /> },
              { href: "/admin/catalogo", label: "Seguradoras e produtos", icon: <IconTag size={18} /> },
              { href: "/admin/lacunas", label: "Perguntas sem resposta", icon: <IconGap size={18} />, count: o.gaps },
              { href: "/admin/qualidade", label: "Avaliações", icon: <IconStar size={18} />, count: o.negative },
            ]}
          />
        </aside>
        <main className="admin-main">{children}</main>
      </div>
    </>
  );
}
