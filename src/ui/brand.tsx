import Link from "next/link";


/**
 * Fonte única do nome e das frases da marca. Nenhuma tela escreve
 * “Vera.ia” à mão: importa daqui. Trocar uma frase = trocar aqui.
 */
export const BRAND = {
  name: "Vera.ia",
  /** Complemento institucional (rodapé, e-mail, metadados). */
  descriptor: "Inteligência para corretores de seguros",
  descriptorLong: "IA aplicada ao mercado de seguros",
  /** Proposta central. */
  promise: "A Vera.ia apoia o corretor com respostas confiáveis, baseadas nos documentos de cada seguradora, com agilidade, clareza e fonte.",
  headline: "Conhecimento que dá segurança.",
  /** Aviso de responsabilidade: aparece onde há resposta. */
  disclaimer:
    "A Vera.ia apoia a sua análise com base nos documentos da corretora. Ela não garante cobertura: confirme o caso concreto na apólice e com a seguradora.",
  domain: "apoiaseguro.com.br",
} as const;

/**
 * Wordmark Vera.ia: “vera” + “.ia” em destaque (coral), com o símbolo em V.
 * Desenhado em curvas a partir da Inter Display, com o I serifado (variante
 * cv08) para não ser lido como l em nenhum navegador. `size` = altura da
 * maiúscula aproximada, em px.
 */
export function Wordmark({
  size = 20,
  onDark = false,
  href,
  ariaLabel = BRAND.name,
}: {
  size?: number;
  onDark?: boolean;
  href?: string;
  ariaLabel?: string;
}) {
  const height = Math.round(size * 1.3);
  const svg = (
    <span role="img" aria-label={href ? undefined : ariaLabel} aria-hidden={href ? true : undefined} style={{display:"inline-flex",alignItems:"center",gap:size*0.28,whiteSpace:"nowrap",fontSize:height,fontWeight:750,letterSpacing:"-0.06em",lineHeight:1,color:onDark?"#F4EDE2":"#401C28"}}>
      <BrandTile size={height} /><span>vera<span style={{color:onDark?"#F26445":"#A63829"}}>.ia</span></span>
    </span>
  );
  return href ? (
    <Link href={href} className="wordmark-link" aria-label={ariaLabel}>
      {svg}
    </Link>
  ) : (
    svg
  );
}

/** Símbolo provisório “IA” em ladrilho (favicon, app, avatar, cabeçalho compacto). */
export function BrandTile({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <rect width="64" height="64" rx="14" fill="#401C28" />
      <path fill="#F26445" d="M9 19 Q8 15 14 15 H21 Q27 15 30 22 L42 42 Q37 54 30 51 Q25 50 21 43Z" />
      <path fill="#F5B544" d="M28 40 L43 12 Q45 8 50 8 H56 Q60 8 57 14 L43 40 Q38 45 28 40Z" />
    </svg>
  );
}

/** Rodapé discreto das áreas logadas. */
export function AppFooter() {
  return (
    <footer className="app-footer">
      <span>
        {BRAND.name} · {BRAND.descriptor}
      </span>
      <span>As respostas apoiam a análise do corretor e mostram a fonte. Não substituem a apólice nem a seguradora.</span>
    </footer>
  );
}
