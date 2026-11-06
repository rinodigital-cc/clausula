/**
 * Geração da resposta.
 *
 * Dois modos, o MESMO validador de ancoragem (herdado da versão anterior do produto):
 *
 *  - generative: Claude com saída estruturada por ferramenta obrigatória. Cada
 *    afirmação precisa citar o id de um trecho recuperado e copiar um pedaço
 *    literal dele. O validador remove o que não confere.
 *  - extractive: sem chave de IA (ou com orçamento esgotado). Não redige nada:
 *    seleciona as frases literais mais pertinentes dos trechos recuperados.
 *    É o modo usado nos testes deste ambiente — e é honesto sobre isso na tela.
 *
 * Texto recuperado é DADO, nunca instrução: vai entre delimitadores aleatórios
 * e trechos com padrão de injeção nem chegam aqui (filtrados na recuperação).
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  ESQUEMA_RESPOSTA,
  INSTRUCAO_SISTEMA,
  custoBRL,
  delimitadorAleatorio,
  montarMensagem,
  normalizar,
  validarAncoragem,
  type Afirmacao,
  type Recuperado,
  type SaidaModelo,
} from "./nucleo";
import type { Retrieved } from "./retrieval";

export type Warning =
  | { kind: "vigencia_vencida"; source_title: string; valid_until: string }
  | { kind: "fontes_diferentes"; titles: string[] }
  | { kind: "varias_seguradoras"; insurers: string[] }
  | { kind: "restricao_ausente" }
  | { kind: "trechos_removidos"; count: number }
  | { kind: "modo_extrativo" }
  | { kind: "ia_indisponivel" }
  | { kind: "orcamento_economico" };

export type AnswerClaim = Afirmacao & { citation: number };

export type AnswerResult = {
  mode: "generative" | "extractive";
  model: string | null;
  status: "answered" | "partial" | "conflict" | "not_found";
  confidence: "strong" | "partial" | "not_found";
  summary: string;
  claims: AnswerClaim[];
  cited: Retrieved[];
  warnings: Warning[];
  suggestedRephrase?: string;
  tokensIn: number;
  tokensOut: number;
  costBrl: number;
};

const KIND_TO_NUCLEO: Record<string, string> = {
  coverage: "coverage",
  exclusion: "exclusion",
  waiting_period: "condition",
  definition: "definition",
  procedure: "procedure",
  general: "other",
  table: "other",
};

function toRecuperado(c: Retrieved): Recuperado {
  return {
    chunk_id: c.chunk_id,
    source_title: c.source_title,
    insurer_name: c.insurer_name,
    page_number: c.page_number,
    clause_path: c.clause_path,
    clause_title: c.clause_title,
    section_kind: KIND_TO_NUCLEO[c.section_kind] ?? "other",
    content: c.content,
  };
}

// ---------------------------------------------------------------------------
// Modo extrativo
// ---------------------------------------------------------------------------
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.;!?])\s+(?=[A-ZÀ-Ú0-9“"(])/)
    .map((s) => s.trim())
    .filter((s) => s.split(" ").length >= 4);
}

function sentenceHits(sentence: string, terms: string[]): number {
  const words = normalizar(sentence).split(" ");
  let hits = 0;
  for (const t of terms) {
    const stem = t.slice(0, Math.max(4, Math.min(6, t.length - 1)));
    if (words.some((w) => w.startsWith(stem))) hits++;
  }
  return hits;
}

/** Janela de até 32 palavras com mais termos, cortada no próprio texto (literal). */
function bestWindow(sentence: string, terms: string[]): string {
  const words = sentence.split(" ");
  if (words.length <= 32) return sentence;
  let best = 0;
  let bestStart = 0;
  for (let i = 0; i + 32 <= words.length; i++) {
    const h = sentenceHits(words.slice(i, i + 32).join(" "), terms);
    if (h > best) {
      best = h;
      bestStart = i;
    }
  }
  return words.slice(bestStart, bestStart + 32).join(" ");
}

export function extractiveAnswer(question: string, terms: string[], chunks: Retrieved[], allTerms: string[] = terms): SaidaModelo {
  if (chunks.length === 0) return { status: "not_found", summary: "", claims: [] };

  // Relevância mínima, medida contra TODOS os termos da pergunta (inclusive os
  // que não existem no acervo): com 3 ou mais, o trecho precisa tocar ao menos
  // 2. Evita citar a carência de ROUBO para uma pergunta sobre carência de
  // DOENÇA PREEXISTENTE só porque as duas falam em “carência”. Na dúvida, o
  // sistema diz que não encontrou.
  const minHits = allTerms.length >= 3 ? 2 : 1;
  const pick = (c: Retrieved) => {
    if (sentenceHits(c.content, allTerms) < minHits) return null;
    let best: { s: string; hits: number } | null = null;
    for (const s of sentences(c.content)) {
      const hits = sentenceHits(s, terms);
      if (!best || hits > best.hits) best = { s, hits };
    }
    return best && best.hits > 0 ? { quote: bestWindow(best.s, terms), hits: best.hits } : null;
  };

  const isRestriction = (c: Retrieved) => c.section_kind === "exclusion" || c.section_kind === "waiting_period";
  const claims: Afirmacao[] = [];
  let bestAnswerHits = 0;

  for (const c of chunks.filter(isRestriction).slice(0, 2)) {
    const p = pick(c);
    if (p) claims.push({ kind: "restriction", text: p.quote, chunk_id: c.chunk_id, quote: p.quote });
  }
  for (const c of chunks.filter((c) => !isRestriction(c)).slice(0, 2)) {
    const p = pick(c);
    if (p) {
      claims.push({ kind: claims.some((x) => x.kind === "answer") ? "detail" : "answer", text: p.quote, chunk_id: c.chunk_id, quote: p.quote });
      bestAnswerHits = Math.max(bestAnswerHits, p.hits);
    }
  }
  if (claims.length === 0) return { status: "not_found", summary: "", claims: [] };

  const strongBar = Math.min(2, Math.max(1, terms.length - 1));
  const answered = claims.some((c) => c.kind === "answer") && bestAnswerHits >= strongBar;
  const docs = [...new Set(chunks.filter((c) => claims.some((k) => k.chunk_id === c.chunk_id)).map((c) => c.source_title))];
  return {
    status: answered ? "answered" : "partial",
    summary:
      `Encontrei ${claims.length === 1 ? "um trecho" : `${claims.length} trechos`} sobre isso em ${docs.join(" e ")}. ` +
      "Leia as passagens abaixo antes de responder ao cliente: elas são o texto do documento, sem interpretação.",
    claims,
  };
}

// ---------------------------------------------------------------------------
// Modo generativo (Claude)
// ---------------------------------------------------------------------------
async function generativeAnswer(
  question: string,
  chunks: Retrieved[],
  orgInstructions: string,
  model: string,
): Promise<{ out: SaidaModelo; tokensIn: number; tokensOut: number }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 45_000, maxRetries: 1 });
  const delim = delimitadorAleatorio();
  const response = await client.messages.create({
    model,
    max_tokens: 1500,
    system: INSTRUCAO_SISTEMA,
    tools: [
      {
        name: "responder",
        description: "Devolve a resposta estruturada, ancorada nos trechos.",
        input_schema: ESQUEMA_RESPOSTA as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: "responder" },
    messages: [{ role: "user", content: montarMensagem(question, chunks.map(toRecuperado), orgInstructions, delim) }],
  });
  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("Modelo não devolveu a ferramenta de resposta");
  return {
    out: block.input as SaidaModelo,
    tokensIn: response.usage.input_tokens,
    tokensOut: response.usage.output_tokens,
  };
}

export function generativeAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// ---------------------------------------------------------------------------
// Orquestração + avisos
// ---------------------------------------------------------------------------
export async function answerQuestion(input: {
  question: string;
  terms: string[];
  /** Todos os termos da pergunta, inclusive os ausentes do acervo (relevância do modo literal). */
  allTerms?: string[];
  chunks: Retrieved[];
  insurerFiltered: boolean;
  orgInstructions?: string;
  budget: "normal" | "economy" | "exhausted";
  today?: Date;
}): Promise<AnswerResult> {
  const warnings: Warning[] = [];
  let mode: AnswerResult["mode"] = "extractive";
  let model: string | null = null;
  let out: SaidaModelo;
  let tokensIn = 0;
  let tokensOut = 0;

  const canGenerate = generativeAvailable() && input.budget !== "exhausted" && input.chunks.length > 0;
  if (canGenerate) {
    model =
      input.budget === "economy"
        ? process.env.ANSWER_MODEL_ECONOMY ?? "claude-haiku-5-5"
        : process.env.ANSWER_MODEL ?? "claude-sonnet-5-5";
    if (input.budget === "economy") warnings.push({ kind: "orcamento_economico" });
    try {
      const g = await generativeAnswer(input.question, input.chunks, input.orgInstructions ?? "", model);
      out = g.out;
      tokensIn = g.tokensIn;
      tokensOut = g.tokensOut;
      mode = "generative";
    } catch (e) {
      console.error(JSON.stringify({ level: "error", event: "ai_generation_failed", message: (e as Error).message }));
      warnings.push({ kind: "ia_indisponivel" });
      out = extractiveAnswer(input.question, input.terms, input.chunks, input.allTerms ?? input.terms);
      model = null;
    }
  } else {
    out = extractiveAnswer(input.question, input.terms, input.chunks, input.allTerms ?? input.terms);
    if (input.chunks.length > 0) warnings.push({ kind: "modo_extrativo" });
  }

  const validated = validarAncoragem(out, input.chunks.map(toRecuperado));
  const byId = new Map(input.chunks.map((c) => [c.chunk_id, c]));
  const citedIds = [...new Set(validated.claims.map((c) => c.chunk_id))];
  const cited = citedIds.map((id) => byId.get(id)!).filter(Boolean);
  const claims: AnswerClaim[] = validated.claims.map((c) => ({ ...c, citation: citedIds.indexOf(c.chunk_id) + 1 }));

  if (validated.removed > 0) warnings.push({ kind: "trechos_removidos", count: validated.removed });
  if (validated.missing_restriction) warnings.push({ kind: "restricao_ausente" });

  // Vigência vencida nas fontes citadas
  const today = (input.today ?? new Date()).toISOString().slice(0, 10);
  for (const c of cited) {
    if (c.valid_until && c.valid_until < today) {
      warnings.push({ kind: "vigencia_vencida", source_title: c.source_title, valid_until: c.valid_until });
    }
  }
  // Mais de um documento para a MESMA seguradora/produto → divergência possível
  const groups = new Map<string, Set<string>>();
  for (const c of cited) {
    const key = `${c.insurer_id ?? "-"}|${c.product_id ?? "-"}`;
    if (!c.insurer_id) continue;
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key)!.add(c.source_id);
  }
  let conflict = validated.status === "conflict";
  for (const [key, set] of groups) {
    if (set.size > 1) {
      conflict = true;
      warnings.push({
        kind: "fontes_diferentes",
        titles: [...new Set(cited.filter((c) => `${c.insurer_id ?? "-"}|${c.product_id ?? "-"}` === key).map((c) => c.source_title))],
      });
    }
  }
  const insurers = [...new Set(cited.map((c) => c.insurer_name).filter((x): x is string => !!x))];
  if (!input.insurerFiltered && insurers.length > 1) warnings.push({ kind: "varias_seguradoras", insurers });

  let confidence = validated.confidence;
  let status: AnswerResult["status"] = conflict && confidence !== "not_found" ? "conflict" : validated.status;
  const downgrade = warnings.some((w) => w.kind === "vigencia_vencida" || w.kind === "fontes_diferentes");
  if (confidence === "strong" && downgrade) confidence = "partial";
  if (confidence === "not_found") status = "not_found";

  const priceIn = Number(process.env.AI_PRICE_IN_BRL_PER_MTOK ?? "0");
  const priceOut = Number(process.env.AI_PRICE_OUT_BRL_PER_MTOK ?? "0");

  return {
    mode,
    model,
    status,
    confidence,
    summary:
      confidence === "not_found"
        ? "Não encontrei isso nos documentos da corretora."
        : validated.summary,
    claims,
    cited,
    warnings,
    suggestedRephrase: validated.suggested_rephrase,
    tokensIn,
    tokensOut,
    costBrl: mode === "generative" ? custoBRL(tokensIn, tokensOut, priceIn, priceOut) : 0,
  };
}
