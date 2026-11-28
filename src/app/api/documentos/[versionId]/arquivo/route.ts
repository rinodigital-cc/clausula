import { getTenant } from "@/lib/auth/web";
import { getVersionFile } from "@/lib/domain/documents";
import { readOriginal } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Entrega o PDF original. Autorização ANTES de tocar no disco: a versão é
 * lida sob RLS; se pertence a outra corretora, simplesmente não existe (404).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await ctx.params;
  const t = await getTenant();
  if (!t) return new Response("Não autenticado.", { status: 401 });
  const file = await getVersionFile(t.session, versionId).catch(() => null);
  if (!file) return new Response("Documento não encontrado.", { status: 404 });
  let data: Buffer;
  try {
    data = await readOriginal(file.fileKey);
  } catch {
    return new Response("Arquivo original indisponível.", { status: 404 });
  }
  const safeName = file.fileName.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "documento.pdf";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(data.length),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
