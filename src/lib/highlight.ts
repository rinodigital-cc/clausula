/**
 * Localiza o trecho citado dentro do texto da página, tolerando diferenças
 * de acento, caixa, pontuação e espaços. Devolve as três partes para a tela
 * grifar o trecho exato (antes · trecho · depois). Sem HTML: o React escapa.
 */
function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < text.length; i++) {
    const base = text[i]!.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (const ch of base) {
      const isWord = /[a-z0-9%$]/.test(ch);
      if (isWord) {
        norm += ch;
        map.push(i);
        lastSpace = false;
      } else if (!lastSpace) {
        norm += " ";
        map.push(i);
        lastSpace = true;
      }
    }
  }
  return { norm, map };
}

function normalizeQuery(q: string): string {
  return q
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%$]+/g, " ")
    .trim();
}

export function splitHighlight(text: string, quote: string | null | undefined): [string, string, string] | null {
  if (!quote) return null;
  const { norm, map } = normalizeWithMap(text);
  const candidates = [normalizeQuery(quote)];
  const words = candidates[0]!.split(" ");
  if (words.length > 10) candidates.push(words.slice(0, 10).join(" "));
  if (words.length > 6) candidates.push(words.slice(0, 6).join(" "));
  for (const c of candidates) {
    if (c.length < 8) continue;
    const at = norm.indexOf(c);
    if (at < 0) continue;
    const start = map[at]!;
    const endNorm = at + c.length;
    const end = (map[Math.min(endNorm, map.length) - 1] ?? text.length - 1) + 1;
    // estende até o fim da palavra
    let e = end;
    while (e < text.length && /[\p{L}\p{N}]/u.test(text[e]!)) e++;
    return [text.slice(0, start), text.slice(start, e), text.slice(e)];
  }
  return null;
}

/**
 * Junta as quebras de linha que a extração do PDF deixa no meio das frases
 * (“com mais de 10⏎anos de fabricação”), mantendo títulos e itens numerados
 * em linhas próprias. Só para exibição: o grifo continua localizando o trecho
 * porque splitHighlight ignora diferenças de espaço.
 */
export function reflow(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    const prev = out.length ? out[out.length - 1]! : null;
    const startsLower = /^\s*[a-zà-ÿ(“"]/.test(line);
    const prevOpen = prev !== null && prev.trim() !== "" && !/[.:;!?]$/.test(prev.trim());
    const prevIsHeading = prev !== null && /^\s*(\d+(\.\d+)*\.?\s+)?[^a-zà-ÿ]*$/.test(prev) && prev.trim().length < 80;
    if (prev !== null && line.trim() !== "" && prevOpen && !prevIsHeading && (startsLower || /,$/.test(prev.trim()))) {
      out[out.length - 1] = `${prev} ${line.trimStart()}`;
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}
