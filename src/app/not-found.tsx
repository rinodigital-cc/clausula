import Link from "next/link";
import { BRAND, Wordmark } from "@/ui/brand";

export default function NotFound() {
  return (
    <main id="conteudo" className="container" style={{ minHeight: "80vh", display: "grid", placeItems: "center" }}>
      <div className="stack" style={{ maxWidth: 520 }}>
        <Wordmark size={22} href="/" ariaLabel={`${BRAND.name}, página inicial`} />
        <h1 className="display" style={{ fontSize: "var(--text-2xl)" }}>Esta página não existe ou mudou de lugar</h1>
        <p className="muted">O link pode ser antigo. Volte para o início ou, se você já tem acesso, siga para a consulta.</p>
        <div className="row">
          <Link className="btn btn-primary" href="/app">Ir para a consulta</Link>
          <Link className="btn btn-secondary" href="/">Página inicial</Link>
        </div>
      </div>
    </main>
  );
}
