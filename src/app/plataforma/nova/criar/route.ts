import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/web";
import { createBrokerage } from "@/lib/domain/platform";
import { notifyProcessor } from "@/lib/processing";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]!));

export async function POST(request: NextRequest) {
  const actor = await requirePlatformAdmin();
  const form = await request.formData();
  const name = s(form, "nome");
  const email = s(form, "email");
  try {
    const r = await createBrokerage(actor, {
      name,
      document: s(form, "documento") || undefined,
      ownerEmail: email,
      ownerName: s(form, "responsavel") || undefined,
      insurers: s(form, "seguradoras").split(/[\n,;]+/),
      joinAsImplementer: form.get("implantador") === "on",
    });
    try { await notifyProcessor(); } catch { /* convite manual continua válido */ }

    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Corretora criada · ApoIA Seguro</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f5f7fb;color:#0f172a;margin:0;padding:24px}.box{max-width:720px;margin:40px auto;background:white;border-radius:24px;padding:28px;box-shadow:0 12px 40px #0f172a18}.ok{background:#ecfdf5;color:#065f46;padding:16px;border-radius:14px}.link{display:block;word-break:break-all;background:#f8fafc;padding:14px;border-radius:12px;margin:16px 0}.btn{display:inline-block;padding:12px 18px;border-radius:12px;background:#2563eb;color:white;text-decoration:none;font-weight:700}.muted{color:#64748b}</style></head><body><main class="box">
<h1>Corretora criada</h1><p class="ok">A corretora <strong>${esc(name)}</strong> foi criada em modo teste.</p>
<p>Envie este link de primeiro acesso para <strong>${esc(email.toLowerCase())}</strong>. Ele vale por 7 dias e funciona uma vez.</p>
<code class="link">${esc(r.inviteLink)}</code>
<p><a class="btn" href="/plataforma">Voltar para corretoras</a></p>
<p class="muted">Você também pode copiar o link acima manualmente.</p>
</main></body></html>`;
    return new NextResponse(html, { status: 200, headers: { "content-type":"text/html; charset=utf-8", "cache-control":"private, no-store", "content-disposition":"inline" }});
  } catch (e) {
    const message = e instanceof Error && e.message.length < 300 ? e.message : "Não foi possível criar a corretora.";
    const url = new URL("/plataforma/nova", request.url);
    url.searchParams.set("erro", message);
    return NextResponse.redirect(url, 303);
  }
}
