import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { requirePlatformAdmin } from "@/lib/auth/web";
import { createBrokerage } from "@/lib/domain/platform";
import { deliverNow } from "@/lib/email/deliver";
import { relativeRedirect } from "@/lib/http/redirect";
import { CREATED_COOKIE } from "@/lib/http/cookies";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // navegadores antigos não enviam Origin em POST de formulário
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try { return !!host && new URL(origin).host === host; } catch { return false; }
}

/** POST nativo (funciona sem JavaScript). Erros internos nunca chegam à tela. */
export async function POST(request: NextRequest) {
  const actor = await requirePlatformAdmin();
  if (!sameOrigin(request)) return relativeRedirect("/plataforma/nova?erro=" + encodeURIComponent("Origem da requisição inválida."));
  const form = await request.formData();
  const name = s(form, "nome");
  const email = s(form, "email").toLowerCase();
  try {
    const r = await createBrokerage(actor, {
      name,
      document: s(form, "documento") || undefined,
      ownerEmail: email,
      ownerName: s(form, "responsavel") || undefined,
      insurers: s(form, "seguradoras").split(/[\n,;]+/),
      joinAsImplementer: form.get("implantador") === "on",
    });
    // A corretora e o convite já estão gravados: falha de envio não desfaz o cadastro.
    const delivery = await deliverNow([r.emailId]);
    (await cookies()).set(CREATED_COOKIE, JSON.stringify({ name, email, link: r.inviteLink, orgId: r.orgId, accepted: delivery.accepted, provider: delivery.provider }), {
      httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/plataforma/nova/criada", maxAge: 600,
    });
    return relativeRedirect("/plataforma/nova/criada");
  } catch (e) {
    const known = e instanceof Error && /^(Nome|E-mail|Já existe|Apenas)/.test(e.message);
    const message = known ? (e as Error).message : "Não foi possível criar a corretora. Nada foi enviado; tente novamente.";
    if (!known) console.error(JSON.stringify({ event: "brokerage_create_failed", message: e instanceof Error ? e.message.slice(0, 200) : "unknown" }));
    return relativeRedirect("/plataforma/nova?erro=" + encodeURIComponent(message));
  }
}
