import Link from "next/link";
import type { Citation, MessageView } from "@/lib/domain/consult";
import type { Warning } from "@services/ai/answer";
import { formatDate } from "@/ui/components";
import { IconInfo, IconWarn } from "@/ui/icons";

/** Texto honesto para cada aviso produzido pelo motor de resposta. */
export function warningText(w: Warning): { tone: "info" | "warn"; title: string; body: string } {
  switch (w.kind) {
    case "vigencia_vencida":
      return {
        tone: "warn",
        title: "Vigência encerrada.",
        body: `O documento “${w.source_title}” vale até ${formatDate(w.valid_until)}. Confirme se existe versão mais recente antes de orientar o cliente.`,
      };
    case "fontes_diferentes":
      return {
        tone: "warn",
        title: "Os documentos não dizem a mesma coisa.",
        body: `Os trechos vêm de fontes diferentes (${w.titles.join("; ")}). Verifique qual se aplica à apólice do cliente.`,
      };
    case "varias_seguradoras":
      return {
        tone: "info",
        title: "Mais de uma seguradora.",
        body: `A resposta reúne trechos de ${w.insurers.join(", ")}. Para separar, escolha a seguradora no campo de pergunta.`,
      };
    case "restricao_ausente":
      return {
        tone: "info",
        title: "Sem exclusão nos trechos encontrados.",
        body: "Não apareceu exclusão ou condição ligada a esta pergunta. Isso não garante que não exista: vale conferir a seção de riscos excluídos.",
      };
    case "trechos_removidos":
      return {
        tone: "info",
        title: "Conferido com o documento.",
        body: `${w.count} ${w.count === 1 ? "afirmação foi retirada" : "afirmações foram retiradas"} por não corresponder literalmente ao documento.`,
      };
    case "modo_extrativo":
      return {
        tone: "info",
        title: "Modo literal.",
        body: "A redação da IA não está ativa neste ambiente. A resposta reúne as frases mais pertinentes do próprio documento; a interpretação fica com você.",
      };
    case "ia_indisponivel":
      return {
        tone: "warn",
        title: "IA indisponível no momento.",
        body: "A resposta reúne só frases literais dos documentos. Tente de novo em alguns minutos para receber o resumo.",
      };
    case "orcamento_economico":
      return {
        tone: "info",
        title: "Modo econômico.",
        body: "O limite diário de uso da corretora está próximo, então a resposta usou uma versão mais simples da IA. As fontes continuam valendo.",
      };
  }
}

/**
 * Avisos da resposta. Os de risco viram uma ressalva em destaque (âmbar);
 * os informativos ficam como notas discretas, sem caixa, para não competir
 * com a resposta.
 */
export function Warnings({ warnings }: { warnings: Warning[] }) {
  if (!warnings.length) return null;
  const all = warnings.map(warningText);
  const risks = all.filter((t) => t.tone === "warn");
  const infos = all.filter((t) => t.tone !== "warn");
  return (
    <>
      {risks.map((t, i) => (
        <div key={`w${i}`} className="caveat" role="note">
          <span className="i" aria-hidden="true"><IconWarn size={15} /></span>
          <p><b>{t.title}</b> {t.body}</p>
        </div>
      ))}
      {infos.length ? (
        <ul className="notes" aria-label="Observações sobre esta resposta">
          {infos.map((t, i) => (
            <li key={`i${i}`}><IconInfo size={15} /><span><b>{t.title}</b> {t.body}</span></li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

const KIND_LABEL: Record<string, string> = { restriction: "Atenção", answer: "Resposta", detail: "Detalhe" };

export function citationLabel(c: Citation): string {
  const parts = [c.clausePath ? `Cláusula ${c.clausePath}` : null, c.pageNumber ? `p. ${c.pageNumber}` : null].filter(Boolean);
  return parts.join(" · ");
}

export function citationHref(conversationId: string, m: MessageView, c: Citation): string {
  return `/app/consulta/${conversationId}?m=${m.id}&fonte=${m.id}-${c.ordinal}#m-${m.id}`;
}

export function Claims({ m, conversationId, activeOrdinal }: { m: MessageView; conversationId: string; activeOrdinal?: number | null }) {
  if (!m.claims.length) return null;
  const order = { restriction: 0, answer: 1, detail: 2 } as Record<string, number>;
  const claims = [...m.claims].sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3));
  const activeIndex = activeOrdinal == null ? -1 : claims.findIndex((c) => c.citation === activeOrdinal);
  return (
    <ol className="claims" aria-label="Afirmações e suas fontes">
      {claims.map((c, i) => {
        const cit = m.citations.find((x) => x.ordinal === c.citation);
        // Só a primeira afirmação ligada à fonte em foco fica ativa (é dela que sai o fio até o grifo)
        const active = i === activeIndex;
        const body = (
          <>
            <span className="n" aria-hidden="true">{c.citation}</span>
            <span className="t">
              <span className="k">{KIND_LABEL[c.kind] ?? "Detalhe"}</span>
              {c.text}
            </span>
            {cit && citationLabel(cit) ? <span className="where">{shortLabel(cit)}</span> : null}
          </>
        );
        return (
          <li key={i} className={`claim claim--${c.kind}`} data-active={active ? "true" : undefined} data-claim-active={active ? "" : undefined}>
            {cit ? (
              <Link href={citationHref(conversationId, m, cit)} aria-label={`${KIND_LABEL[c.kind] ?? "Detalhe"}: ${c.text}. Ver fonte ${c.citation}${citationLabel(cit) ? `, ${citationLabel(cit)}` : ""}`} scroll={false}>
                {body}
              </Link>
            ) : (
              <div>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Rótulo curto para a margem: “cl. 9.4 · p. 2”. */
export function shortLabel(c: Citation): string {
  return [c.clausePath ? `cl. ${c.clausePath}` : null, c.pageNumber ? `p. ${c.pageNumber}` : null].filter(Boolean).join(" · ");
}
