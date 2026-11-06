import Link from "next/link";
import { WORDMARK } from "@/ui/wordmark-data";

/**
 * Fonte única do nome e das frases da marca. Nenhuma tela escreve
 * “ApoIA Seguro” à mão: importa daqui. Trocar uma frase = trocar aqui.
 */
export const BRAND = {
  name: "ApoIA Seguro",
  /** Complemento institucional (rodapé, e-mail, metadados). */
  descriptor: "Inteligência para corretores de seguros",
  descriptorLong: "IA aplicada ao mercado de seguros",
  /** Proposta central. */
  promise: "IA que apoia o corretor com respostas técnicas sobre seguros, com base documental.",
  headline: "Menos dúvida. Mais clareza para orientar o cliente.",
  /** Aviso de responsabilidade: aparece onde há resposta. */
  disclaimer:
    "A ApoIA Seguro apoia a sua análise com base nos documentos da corretora. Ela não garante cobertura: confirme o caso concreto na apólice e com a seguradora.",
  domain: "apoiaseguro.com.br",
} as const;

/**
 * Wordmark provisório (até o logo final): “Apo” + “IA” em destaque + “Seguro”.
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
    <svg
      viewBox={WORDMARK.viewBox}
      height={height}
      width={Math.round(height * WORDMARK.ratio)}
      role="img"
      aria-label={href ? undefined : ariaLabel}
      aria-hidden={href ? true : undefined}
      focusable="false"
      style={{ display: "block" }}
    >
      <path d={WORDMARK.apo} style={{ fill: onDark ? "#FFFFFF" : "var(--brand-navy)" }} />
      <path d={WORDMARK.ia} style={{ fill: onDark ? "var(--brand-ia-light)" : "var(--brand-ia)" }} />
      <path d={WORDMARK.seg} style={{ fill: onDark ? "#FFFFFF" : "var(--brand-navy)" }} />
    </svg>
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
      <rect width="64" height="64" rx="14" fill="#12305C" />
      <path fill="#FFFFFF" d="M11.5 18h14v4h-4v20h4v4h-14v-4h4V22h-4z" />
      <path fill="#FFFFFF" fillRule="evenodd" d="M30.5 46L38 18h7l7.5 28h-6.4l-1.6-6h-6l-1.6 6zM39.9 34.8h3.2L41.5 28.83z" />
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
