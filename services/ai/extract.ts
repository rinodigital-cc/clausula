/**
 * Extração de texto de PDF, página a página, com reconstrução de linhas.
 *
 * Roda SÓ no worker (processo Node separado). A rodada de setembro achou
 * incompatibilidade da biblioteca de PDF com o empacotador do Next; manter a
 * extração fora do bundle web elimina essa classe de problema.
 */
import path from "node:path";
import { createRequire } from "node:module";

export type ExtractedPdf = { pages: string[]; pageCount: number };

export class ExtractionError extends Error {
  constructor(message: string, public readonly userMessage: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

type TextItem = { str: string; transform: number[]; hasEOL?: boolean };

export async function extractPdf(data: Uint8Array): Promise<ExtractedPdf> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const require = createRequire(__filename);
  const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = path.toNamespacedPath(workerPath);

  let doc;
  try {
    doc = await pdfjs.getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
      verbosity: 0,
    }).promise;
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (/password/i.test(msg)) {
      throw new ExtractionError(msg, "O PDF está protegido por senha. Remova a senha e envie de novo.");
    }
    throw new ExtractionError(msg, "Não foi possível abrir o arquivo. Confira se é um PDF válido.");
  }

  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push(itemsToText(content.items as TextItem[]));
    page.cleanup();
  }
  await doc.destroy();
  return { pages, pageCount: pages.length };
}

/** Agrupa itens por linha (coordenada y) e devolve texto com quebras reais. */
function itemsToText(items: TextItem[]): string {
  const lines: { y: number; parts: { x: number; s: string }[] }[] = [];
  for (const it of items) {
    if (!it.str) continue;
    const x = it.transform[4] ?? 0;
    const y = Math.round(it.transform[5] ?? 0);
    let line = lines.find((l) => Math.abs(l.y - y) <= 2);
    if (!line) {
      line = { y, parts: [] };
      lines.push(line);
    }
    line.parts.push({ x, s: it.str });
  }
  lines.sort((a, b) => b.y - a.y);
  return lines
    .map((l) =>
      l.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.s)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}
