import type { Metadata } from "next";
import { CONSENT_TEXT } from "@/lib/domain/leads";
import { BRAND } from "@/ui/brand";
import { SiteFooter, SiteHeader } from "@/ui/site";
import { LeadForm } from "@/app/contato/LeadForm";

export const metadata: Metadata = {
  title: "Contato",
  description: `Fale com a equipe da ${BRAND.name} para ver uma demonstração ou participar do piloto.`,
};

export default async function ContatoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const interest = ["demonstracao", "piloto", "contato"].includes(sp.interesse ?? "") ? sp.interesse! : "demonstracao";
  return (
    <>
      <SiteHeader />
      <main id="conteudo" className="section">
        <div className="container stack-lg" style={{ maxWidth: 820 }}>
          <div className="stack-sm">
            <span className="eyebrow"><span className="dot" />Contato</span>
            <h1 className="display" style={{ fontSize: "var(--text-3xl)" }}>Vamos testar com os documentos da sua corretora?</h1>
            <p className="muted" style={{ maxWidth: "60ch" }}>
              Conte um pouco sobre a sua corretora. Respondemos por e-mail para combinar uma demonstração ou a entrada no piloto.
            </p>
          </div>
          <div className="card card-pad">
            <LeadForm consentText={CONSENT_TEXT} defaultInterest={interest} />
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
