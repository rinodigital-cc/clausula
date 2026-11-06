/**
 * Recuperação de trechos — somente da corretora corrente (a RLS garante; a
 * consulta ainda filtra explicitamente por versão vigente e fonte ativa).
 *
 * Lições herdadas da rodada de setembro, aplicadas aqui:
 *  - Busca com E (todas as palavras) é estrita demais para pergunta de corretor;
 *    usamos OU com contagem de termos casados e limiar relativo.
 *  - Stemming duplo: a consulta é montada SEMPRE a partir do texto original,
 *    nunca de lexema já reduzido.
 *  - A regra de "maioria dos termos" só conta termos que EXISTEM no acervo da
 *    corretora; senão a barra fica inalcançável e tudo vira "não encontrei".
 *  - Pergunta de cobertura puxa também as restrições (exclusão, carência,
 *    franquia) do mesmo documento.
 */
import type { TenantSql } from "@/lib/db/client";

export type Retrieved = {
  chunk_id: string;
  source_id: string;
  source_version_id: string;
  source_title: string;
  insurer_id: string | null;
  insurer_name: string | null;
  product_id: string | null;
  product_name: string | null;
  doc_type: string;
  version_number: number;
  valid_until: string | null;
  page_number: number | null;
  clause_path: string | null;
  clause_title: string | null;
  section_kind: string;
  content: string;
  matched: number;
  score: number;
  via: "search" | "restriction_expansion";
};

const STOPWORDS = new Set(
  (
    "a o as os um uma uns umas de da do das dos em no na nos nas por para pra com sem sob sobre " +
    "e ou mas que se ja já nao não sim qual quais quando como onde quem quanto quanta cada " +
    "meu minha seu sua dele dela isso isto esse essa este esta aquele aquela lhe eles elas " +
    "tem têm ter tenho há ha ser é eh foi são sao estar está esta estão estao fica ficar " +
    "pode posso podem deve devo precisa preciso vai vou fazer faz feito tipo coisa algum alguma " +
    "seguro seguros segurado segurada apolice apólice cliente clientes produto produtos cobre cobrem " +
    "cobertura coberturas coberto coberta cobertos cobertas"
  ).split(/\s+/),
);

// Vocabulário de quem pergunta → vocabulário de quem escreve condições gerais.
const SYNONYMS: Record<string, string[]> = {
  oscilacao: ["variacao", "tensao", "eletricos"],
  queima: ["danos", "eletricos", "curto"],
  raio: ["descarga", "eletrica"],
  carro: ["veiculo", "automovel"],
  roubado: ["roubo", "furto"],
  roubaram: ["roubo", "furto"],
  furtado: ["furto", "roubo"],
  batida: ["colisao"],
  bateu: ["colisao"],
  enchente: ["alagamento", "inundacao"],
  alagou: ["alagamento", "inundacao"],
  vazamento: ["agua", "tubulacao"],
  reserva: ["reserva", "locacao"],
  guincho: ["reboque", "assistencia"],
  morte: ["obito", "falecimento"],
  carencia: ["carencia", "prazo"],
  franquia: ["franquia", "participacao"],
  doenca: ["doenca", "preexistente"],
  exclusoes: ["excluidos", "exclusao", "excluidas"],
  quilometros: ["km"],
  quilometro: ["km"],
  exclusao: ["excluidos", "exclusoes", "excluidas"],
  excluido: ["excluidos", "exclusoes"],
};

/** Normaliza para [a-z0-9] sem acento: é o que entra no to_tsquery, nada mais. */
export function normalizeWord(w: string): string {
  return w
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function queryTerms(question: string): string[] {
  const raw = question.split(/\s+/).map(normalizeWord).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  const expanded: string[] = [];
  for (const w of raw) {
    expanded.push(w);
    for (const s of SYNONYMS[w] ?? []) expanded.push(s);
  }
  return [...new Set(expanded)].slice(0, 14);
}

export type RetrieveOptions = { insurerId?: string | null; productId?: string | null; limit?: number };

export async function retrieve(tx: TenantSql, question: string, opts: RetrieveOptions = {}): Promise<{
  terms: string[];
  presentTerms: string[];
  chunks: Retrieved[];
}> {
  const terms = queryTerms(question);
  if (terms.length === 0) return { terms, presentTerms: [], chunks: [] };
  const limit = opts.limit ?? 8;

  // Quais termos existem no acervo da corretora (regra tipo IDF, medida no acervo)
  // e quão raros são: termo raro ("guincho") pesa mais que termo comum ("limite").
  const present = await tx<{ term: string; df: number; total: number }[]>`
    WITH base AS (
      SELECT c.content_tsv FROM chunks c
      JOIN source_versions v ON v.id = c.source_version_id
      WHERE v.is_current AND v.status IN ('ready','ready_with_warnings') AND NOT c.suspicious
    )
    SELECT t.term,
           (SELECT count(*)::int FROM base b WHERE b.content_tsv @@ to_tsquery('pt_unaccent', t.term)) AS df,
           (SELECT count(*)::int FROM base) AS total
    FROM unnest(${terms}::text[]) AS t(term)
  `;
  const presentRows = present.filter((r) => r.df > 0);
  const presentTerms = presentRows.map((r) => r.term);
  const weights = presentRows.map((r) => Math.log(1 + (r.total || 1) / r.df));
  if (presentTerms.length === 0) return { terms, presentTerms, chunks: [] };

  // Exigência: pelo menos ~40% dos termos PRESENTES (mínimo 1; 2 quando há 4+).
  const minMatched = presentTerms.length >= 4 ? Math.max(2, Math.ceil(presentTerms.length * 0.4)) : 1;
  const orQuery = presentTerms.join(" | ");

  const rows = await tx<Retrieved[]>`
    WITH scored AS (
      SELECT c.id AS chunk_id, s.id AS source_id, v.id AS source_version_id,
             s.title AS source_title, s.insurer_id, i.name AS insurer_name,
             s.product_id, p.name AS product_name, s.doc_type,
             v.version_number, v.valid_until::text AS valid_until,
             c.page_start AS page_number, c.clause_path, c.clause_title, c.section_kind, c.content,
             (SELECT count(*)::int FROM unnest(${presentTerms}::text[]) AS t(term)
               WHERE c.content_tsv @@ to_tsquery('pt_unaccent', t.term)) AS matched,
             (SELECT coalesce(sum(t.w), 0)::float FROM unnest(${presentTerms}::text[], ${weights}::float8[]) AS t(term, w)
               WHERE c.content_tsv @@ to_tsquery('pt_unaccent', t.term)) AS weight,
             ts_rank_cd(c.content_tsv, to_tsquery('pt_unaccent', ${orQuery}), 32) AS rank
      FROM chunks c
      JOIN source_versions v ON v.id = c.source_version_id
      JOIN knowledge_sources s ON s.id = v.source_id
      LEFT JOIN insurers i ON i.id = s.insurer_id
      LEFT JOIN products p ON p.id = s.product_id
      WHERE v.is_current AND v.status IN ('ready','ready_with_warnings')
        AND s.status = 'active' AND s.deleted_at IS NULL
        AND NOT c.suspicious
        AND c.content_tsv @@ to_tsquery('pt_unaccent', ${orQuery})
        AND (${opts.insurerId ?? null}::uuid IS NULL OR s.insurer_id = ${opts.insurerId ?? null}::uuid)
        AND (${opts.productId ?? null}::uuid IS NULL OR s.product_id = ${opts.productId ?? null}::uuid)
    )
    SELECT *, (weight + matched * 0.5 + rank * 5.0) AS score, 'search' AS via
    FROM scored
    WHERE matched >= ${minMatched}
    ORDER BY score DESC
    LIMIT ${limit}
  `;

  const chunks = rows.map((r) => ({ ...r, score: Number(r.score), matched: Number(r.matched) }));

  // Expansão obrigatória cobertura ⇄ restrição, por versão de documento usada.
  const versions = [...new Set(chunks.map((c) => c.source_version_id))].slice(0, 3);
  if (versions.length > 0) {
    const have = new Set(chunks.map((c) => c.chunk_id));
    const restrictions = await tx<Retrieved[]>`
      SELECT c.id AS chunk_id, s.id AS source_id, v.id AS source_version_id,
             s.title AS source_title, s.insurer_id, i.name AS insurer_name,
             s.product_id, p.name AS product_name, s.doc_type,
             v.version_number, v.valid_until::text AS valid_until,
             c.page_start AS page_number, c.clause_path, c.clause_title, c.section_kind, c.content,
             (SELECT count(*)::int FROM unnest(${presentTerms}::text[]) AS t(term)
               WHERE c.content_tsv @@ to_tsquery('pt_unaccent', t.term)) AS matched,
             0::float AS score, 'restriction_expansion' AS via
      FROM chunks c
      JOIN source_versions v ON v.id = c.source_version_id
      JOIN knowledge_sources s ON s.id = v.source_id
      LEFT JOIN insurers i ON i.id = s.insurer_id
      LEFT JOIN products p ON p.id = s.product_id
      WHERE c.source_version_id = ANY(${versions}::uuid[])
        AND c.section_kind IN ('exclusion','waiting_period')
        AND NOT c.suspicious
        AND c.content_tsv @@ to_tsquery('pt_unaccent', ${orQuery})
      ORDER BY matched DESC
      LIMIT 3
    `;
    for (const r of restrictions) {
      if (!have.has(r.chunk_id) && Number(r.matched) >= 1) {
        chunks.push({ ...r, matched: Number(r.matched), score: Number(r.matched) * 0.5 });
      }
    }
  }

  return { terms, presentTerms, chunks };
}
