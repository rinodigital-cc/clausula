import { requestPasswordReset } from "@/lib/domain/account";

export const dynamic = "force-dynamic";

export async function GET() {
  await requestPasswordReset("marcelorino@gmail.com");
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
