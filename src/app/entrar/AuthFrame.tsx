import { BRAND, Wordmark } from "@/ui/brand";

/** Moldura das telas de acesso: painel azul-profundo com a marca + formulário. */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-brand">
        <div style={{ alignSelf: "flex-start" }}>
          <Wordmark size={24} onDark href="/" ariaLabel={`${BRAND.name}, página inicial`} />
        </div>
        <div className="stack" style={{ gap: 24 }}>
          <p className="claim-line">Respostas técnicas sobre seguros, com a fonte à vista.</p>
          <ul className="auth-points">
            <li>Consulte condições gerais, coberturas, exclusões e carências.</li>
            <li>Cada resposta mostra o trecho e o documento de onde veio.</li>
            <li>Você confere e decide. A IA apoia a análise.</li>
          </ul>
          <figure className="auth-sample" aria-label="Exemplo de como a fonte aparece">
            <figcaption><span className="dot" aria-hidden="true" />Exemplo · trecho grifado no documento</figcaption>
            <blockquote>“…estão cobertos os danos causados ao imóvel por <mark>queda de raio dentro do terreno</mark>, desde que…”</blockquote>
          </figure>
        </div>
        <p className="descr" style={{ fontSize: "var(--text-sm)", color: "#a9bedd" }}>{BRAND.descriptor}</p>
      </aside>
      <main id="conteudo" className="auth-main">{children}</main>
    </div>
  );
}
