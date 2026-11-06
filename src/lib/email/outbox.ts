import type { PrivilegedSql, TenantSql } from "@/lib/db/client";

/**
 * Caixa de saída (padrão outbox). O e-mail é gravado na MESMA transação do
 * fato que o motiva; o worker despacha. Sem provedor configurado, o despacho
 * grava o arquivo em disco e marca "skipped" — nada é dado como enviado sem ter
 * sido enviado.
 */
export type OutgoingEmail = {
  orgId: string | null;
  to: string;
  kind: "invitation" | "password_reset" | "lead_received" | "gap_resolved";
  subject: string;
  text: string;
  html: string;
};

type Executor = TenantSql | PrivilegedSql;

export async function enqueueEmail(db: Executor, m: OutgoingEmail): Promise<void> {
  await (db as TenantSql)`
    INSERT INTO email_outbox (org_id, to_email, kind, subject, body_text, body_html)
    VALUES (${m.orgId}, ${m.to}, ${m.kind}, ${m.subject}, ${m.text}, ${m.html})
  `;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const BRAND_NAME = "ApoIA Seguro";
const BRAND_HTML = `Apo<span style="color:#8DB8FF">IA</span> <span style="font-weight:400">Seguro</span>`;
const FOOTER =
  "ApoIA Seguro · Inteligência para corretores de seguros. As respostas apoiam a análise do corretor e mostram a fonte; não substituem a apólice nem a seguradora.";

function layout(title: string, bodyHtml: string, reason: string): string {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#EDF1F6;font-family:Inter,Arial,sans-serif;color:#2A3545">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden">
<tr><td style="background:#12305C;padding:22px 32px;color:#FFFFFF;font-size:20px;font-weight:700;letter-spacing:-0.3px">${BRAND_HTML}</td></tr>
<tr><td style="padding:32px">
<h1 style="margin:0 0 16px;font-family:Inter,Arial,sans-serif;font-weight:700;font-size:24px;line-height:1.25;letter-spacing:-0.3px;color:#0F1A2A">${esc(title)}</h1>
${bodyHtml}
</td></tr></table>
<p style="font-size:12px;line-height:1.5;color:#586577;max-width:560px;margin:16px auto 0">${esc(reason)}<br>${esc(FOOTER)}</p>
</td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${esc(href)}" style="background:#1B4DB1;color:#FFFFFF;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:600;display:inline-block">${esc(label)}</a></p>
<p style="font-size:13px;color:#586577">Se o botão não funcionar, copie este endereço no navegador:<br><span style="color:#1B4DB1;word-break:break-all">${esc(href)}</span></p>`;
}

export function invitationEmail(p: {
  orgId: string;
  to: string;
  orgName: string;
  inviterName: string;
  roleLabel: string;
  link: string;
  expiresDays: number;
}): OutgoingEmail {
  const subject = `${p.inviterName} convidou você para a ${p.orgName} na ${BRAND_NAME}`;
  const text = `${p.inviterName} convidou você para participar da ${p.orgName} na ${BRAND_NAME} como ${p.roleLabel}.

Aceite o convite: ${p.link}

O convite vale por ${p.expiresDays} dias e só pode ser usado com este e-mail (${p.to}).
Na ${BRAND_NAME}, você consulta condições gerais e documentos da corretora com apoio de IA, e cada resposta mostra o trecho de onde veio.

${FOOTER}`;
  const html = layout(
    `${p.inviterName} convidou você para a ${p.orgName}`,
    `<p style="font-size:16px;line-height:1.6">Você foi convidado para participar como <b>${esc(p.roleLabel)}</b>. Na ${BRAND_NAME}, você consulta condições gerais e documentos da corretora com apoio de IA, e cada resposta mostra o trecho de onde veio.</p>
${button(p.link, "Aceitar convite")}
<p style="font-size:13px;color:#586577">O convite vale por ${p.expiresDays} dias e só pode ser usado com o e-mail ${esc(p.to)}.</p>`,
    `Você recebeu este e-mail porque ${p.inviterName} convidou este endereço para a ${p.orgName}.`,
  );
  return { orgId: p.orgId, to: p.to, kind: "invitation", subject, text, html };
}

export function passwordResetEmail(p: { to: string; link: string; firstAccess: boolean }): OutgoingEmail {
  const subject = p.firstAccess ? `Crie sua senha da ${BRAND_NAME}` : `Redefinição de senha da ${BRAND_NAME}`;
  const intro = p.firstAccess
    ? "Use o link abaixo para criar sua senha de acesso."
    : "Recebemos um pedido para redefinir sua senha. Se não foi você, ignore este e-mail: nada muda.";
  const text = `${intro}\n\n${p.link}\n\nO link vale por 1 hora e só pode ser usado uma vez. A equipe da ${BRAND_NAME} nunca pede sua senha.\n\n${FOOTER}`;
  const html = layout(subject, `<p style="font-size:16px;line-height:1.6">${esc(intro)}</p>${button(p.link, p.firstAccess ? "Criar senha" : "Redefinir senha")}<p style="font-size:13px;color:#586577">O link vale por 1 hora e só pode ser usado uma vez. A equipe da ${BRAND_NAME} nunca pede sua senha.</p>`, "Você recebeu este e-mail porque houve um pedido de acesso para este endereço.");
  return { orgId: null, to: p.to, kind: "password_reset", subject, text, html };
}

export function gapResolvedEmail(p: { orgId: string; to: string; question: string; link: string }): OutgoingEmail {
  const subject = `Sua dúvida agora tem resposta na ${BRAND_NAME}`;
  const text = `A dúvida "${p.question}" foi respondida por quem administra a corretora e já aparece nas consultas, com a fonte: ${p.link}\n\n${FOOTER}`;
  const html = layout(subject, `<p style="font-size:16px;line-height:1.6">A dúvida <b>“${esc(p.question)}”</b> foi respondida por quem administra a corretora e já aparece nas consultas, com a fonte.</p>${button(p.link, "Consultar agora")}`, "Você recebeu este e-mail porque fez esta pergunta na plataforma.");
  return { orgId: p.orgId, to: p.to, kind: "gap_resolved", subject, text, html };
}

export function appUrl(path: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path}`;
}
