import Link from "next/link";
import { BRAND, Wordmark } from "@/ui/brand";

/** Cabeçalho do site público. */
export function SiteHeader() {
  return (
    <header className="site-header">
      <nav className="container" aria-label="Principal">
        <Wordmark size={22} href="/" ariaLabel={`${BRAND.name}, página inicial`} />
        <div className="site-links">
          <Link href="/#como-funciona">Como funciona</Link>
          <Link href="/#confianca">Confiança</Link>
          <Link href="/#perguntas">Perguntas</Link>
          <Link href="/entrar">Entrar</Link>
          <Link href="/contato" className="btn btn-primary btn-sm">Quero testar</Link>
        </div>
      </nav>
    </header>
  );
}

/** Rodapé do site público. Sem CNPJ, endereço ou e-mail: nada disso existe ainda. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container stack-lg">
        <div className="cols">
          <div className="stack-sm" style={{ maxWidth: 380 }}>
            <Wordmark size={22} onDark />
            <p style={{ fontSize: "var(--text-sm)", color: "#b8c6dc" }}>{BRAND.promise}</p>
          </div>
          <nav aria-label="Rodapé">
            <Link href="/#como-funciona">Como funciona</Link>
            <Link href="/contato">Contato</Link>
            <Link href="/entrar">Entrar</Link>
            <Link href="/privacidade">Privacidade</Link>
          </nav>
        </div>
        <p style={{ fontSize: "var(--text-xs)", color: "#8fa1bd", maxWidth: "80ch" }}>
          {BRAND.name} é uma ferramenta de apoio à consulta para corretores de seguros. Não é seguradora nem corretora, não
          presta aconselhamento jurídico e não garante cobertura. As respostas mostram a fonte para que o corretor confira e decida.
        </p>
      </div>
    </footer>
  );
}
