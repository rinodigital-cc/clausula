import Anthropic from "@anthropic-ai/sdk";
import { withPublic, vercelOidcToken } from "@/lib/db/client";
import { saveOriginal, readOriginal, sha256 } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const result: Record<string, unknown> = { ok: false };

  try {
    const [row] = await withPublic(db => db<{ one: number }[]>`SELECT 1::int AS one`);
    result.db = row?.one === 1;
  } catch (e) {
    result.db = false;
    result.dbError = e instanceof Error ? e.message : "db";
  }

  try {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
    const key = await saveOriginal("00000000-0000-4000-8000-000000000001", pdf);
    const back = await readOriginal(key);
    result.storage = sha256(pdf) === sha256(back);
  } catch (e) {
    result.storage = false;
    result.storageError = e instanceof Error ? e.message : "storage";
  }

  try {
    const oidc = await vercelOidcToken();
    if (!oidc) throw new Error("oidc_missing");
    const client = new Anthropic({ apiKey: oidc, baseURL: "https://ai-gateway.vercel.sh", timeout: 30_000, maxRetries: 0 });
    const response = await client.messages.create({
      model: "anthropic/claude-haiku-5.5",
      max_tokens: 8,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
    });
    const text = response.content.find(x => x.type === "text");
    result.ai = text?.type === "text" && text.text.trim().toUpperCase().includes("OK");
    result.aiModel = response.model;
  } catch (e) {
    result.ai = false;
    result.aiError = e instanceof Error ? e.message.slice(0, 300) : "ai";
  }

  result.ok = result.db === true && result.storage === true && result.ai === true;
  return Response.json(result, { status: result.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
