import { AppHeader } from "@/app/app/AppHeader";
import { AppFooter } from "@/ui/brand";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <div id="conteudo">{children}</div>
      <AppFooter />
    </>
  );
}
