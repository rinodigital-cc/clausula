import { randomUUID } from "node:crypto";
import type { PrivilegedSql, TenantSql } from "@/lib/db/client";

/**
 * Caixa de saída (padrão outbox). O e-mail é gravado na MESMA transação do
 * fato que o motiva e despachado logo após o commit (src/lib/email/deliver.ts);
 * a fila e o worker são a rede de segurança. Único caminho de envio: Resend.
 *
 * Templates: HTML em tabelas (Gmail/Outlook), sem JavaScript, sem imagens
 * externas, com versão em texto simples. Nunca contêm senha.
 */
export type EmailKind =
  | "invitation"
  | "brokerage_invitation"
  | "invitation_resend"
  | "password_reset"
  | "first_access"
  | "email_confirmation"
  | "welcome"
  | "password_changed"
  | "lead_received"
  | "gap_resolved";

export type OutgoingEmail = {
  orgId: string | null;
  to: string;
  kind: EmailKind;
  subject: string;
  text: string;
  html: string;
  invitationId?: string | null;
};

type Executor = TenantSql | PrivilegedSql;

/**
 * Grava na caixa de saída e devolve o id (para despacho imediato após o commit).
 * O id é gerado aqui: os papéis de aplicação só têm INSERT (sem RETURNING).
 */
export async function enqueueEmail(db: Executor, m: OutgoingEmail): Promise<string> {
  const id = randomUUID();
  await (db as TenantSql)`
    INSERT INTO email_outbox (id, org_id, to_email, kind, subject, body_text, body_html, invitation_id)
    VALUES (${id}, ${m.orgId}, ${m.to}, ${m.kind}, ${m.subject}, ${m.text}, ${m.html}, ${m.invitationId ?? null})
  `;
  return id;
}

// ------------------------------------------------------------------ marca

export const EMAIL_BRAND = {
  name: "Vera.ia",
  signature: "Vera.ia — Conhecimento que dá segurança.",
  descriptor: "Inteligência para corretores de seguros",
  colors: { wine: "#401C28", coral: "#F26445", sand: "#F4EDE2", graphite: "#252220", muted: "#5E5650", link: "#B3401F", line: "#E6D5C8" },
} as const;

const C = EMAIL_BRAND.colors;
const NAME = EMAIL_BRAND.name;
const SIGNATURE = EMAIL_BRAND.signature;
const DISCLAIMER =
  "A Vera.ia apoia a análise do corretor com base nos documentos da corretora e mostra a fonte; não substitui a apólice nem a seguradora.";
const SECURITY_NOTE = `A equipe da ${NAME} nunca pede sua senha por e-mail, telefone ou mensagem.`;

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function supportLine(): string | null {
  const s = process.env.SUPPORT_EMAIL?.trim();
  return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

function wordmark(): string {
  return `<span style="font-family:Inter,'Segoe UI',Arial,sans-serif;font-size:24px;font-weight:800;letter-spacing:-0.8px;color:${C.sand}">vera<span style="color:${C.coral}">.ia</span></span>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${C.graphite}">${text}</p>`;
}

function small(text: string): string {
  return `<p style="margin:0 0 12px;font-size:13px;line-height:1.55;color:${C.muted}">${text}</p>`;
}

/** Botão "à prova de Outlook": tabela com bgcolor, sem imagens. */
function button(href: string, label: string): string {
  const h = esc(href);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr>
<td bgcolor="${C.wine}" style="border-radius:10px;background:${C.wine}">
<a href="${h}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 24px;font-family:Inter,'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:10px">${esc(label)}</a>
</td></tr></table>
${small(`Se o botão não funcionar, copie e cole este endereço no navegador:<br><a href="${h}" style="color:${C.link};word-break:break-all">${h}</a>`)}`;
}

function layout(o: { preheader: string; title: string; body: string; reason: string }): string {
  const support = supportLine();
  return `<!doctype html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(o.title)}</title>
<style>@media (max-width:620px){.card{width:100%!important}.pad{padding:24px 20px!important}}</style>
</head>
<body style="margin:0;padding:0;background:${C.sand};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.sand}">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.sand}" style="background:${C.sand}">
<tr><td align="center" style="padding:32px 12px">
<table role="presentation" class="card" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;background:#FFFFFF;border-radius:16px;border:1px solid ${C.line}">
<tr><td bgcolor="${C.wine}" style="background:${C.wine};padding:22px 32px;border-radius:16px 16px 0 0">${wordmark()}</td></tr>
<tr><td class="pad" style="padding:32px;font-family:Inter,'Segoe UI',Arial,sans-serif">
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:800;letter-spacing:-0.4px;color:${C.wine}">${esc(o.title)}</h1>
${o.body}
<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${C.line};font-size:14px;line-height:1.5;color:${C.graphite}"><b>${esc(SIGNATURE)}</b></p>
</td></tr></table>
<table role="presentation" width="560" class="card" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px">
<tr><td style="padding:16px 8px;font-family:Inter,'Segoe UI',Arial,sans-serif;font-size:12px;line-height:1.5;color:${C.muted}">
${esc(o.reason)}${support ? `<br>Dúvidas? Escreva para <a href="mailto:${esc(support)}" style="color:${C.link}">${esc(support)}</a>.` : ""}<br>${esc(DISCLAIMER)}
</td></tr></table>
</td></tr></table></body></html>`;
}

function textFooter(reason: string): string {
  const support = supportLine();
  return `\n—\n${SIGNATURE}\n${reason}${support ? `\nDúvidas? ${support}` : ""}\n${DISCLAIMER}\n`;
}

// --------------------------------------------------------------- templates

export function expiryLabel(days: number): string {
  return days === 1 ? "1 dia" : `${days} dias`;
}

/** 1. Convite de corretora (responsável) e 7. reenvio do convite. */
export function brokerageInvitationEmail(p_: {
  orgId: string; to: string; orgName: string; link: string; expiresDays: number; resend?: boolean; invitationId?: string;
}): OutgoingEmail {
  const subject = p_.resend ? `Novo link de acesso à ${NAME}` : `Você foi convidado para acessar a ${NAME}`;
  const title = p_.resend ? "Seu novo link de acesso" : `Bem-vindo à ${NAME}.`;
  const intro = p_.resend
    ? `Geramos um novo convite para a ${p_.orgName}. O link anterior deixou de valer.`
    : `Sua corretora foi convidada para acessar nossa plataforma de inteligência para seguros.`;
  const expiry = `O link vale por ${expiryLabel(p_.expiresDays)}, funciona uma única vez e só com este e-mail (${p_.to}).`;
  const text = `${title}

${intro}
Corretora: ${p_.orgName}

Para começar, defina sua senha de acesso:
${p_.link}

${expiry}
${SECURITY_NOTE}
${textFooter(`Você recebeu este e-mail porque este endereço foi indicado como responsável pela ${p_.orgName}.`)}`;
  const html = layout({
    preheader: "Defina sua senha e comece a consultar os documentos da sua corretora.",
    title,
    body: `${p(esc(intro))}${p(`Corretora: <b>${esc(p_.orgName)}</b>`)}${p("Para começar, defina sua senha de acesso.")}
${button(p_.link, "Criar minha senha")}${small(esc(expiry))}${small(esc(SECURITY_NOTE))}`,
    reason: `Você recebeu este e-mail porque este endereço foi indicado como responsável pela ${p_.orgName}.`,
  });
  return { orgId: p_.orgId, to: p_.to, kind: p_.resend ? "invitation_resend" : "brokerage_invitation", subject, text, html, invitationId: p_.invitationId };
}

/** 2. Convite de usuário para uma corretora (feito por quem administra). */
export function invitationEmail(p_: {
  orgId: string; to: string; orgName: string; inviterName: string; roleLabel: string; link: string; expiresDays: number;
  resend?: boolean; invitationId?: string;
}): OutgoingEmail {
  const subject = p_.resend ? `Novo convite para a ${p_.orgName} na ${NAME}` : `${p_.inviterName} convidou você para a ${p_.orgName} na ${NAME}`;
  const intro = `${p_.inviterName} convidou você para participar da ${p_.orgName} como ${p_.roleLabel}. Na ${NAME}, você consulta condições gerais e documentos da corretora, e cada resposta mostra o trecho de onde veio.`;
  const expiry = `O convite vale por ${expiryLabel(p_.expiresDays)} e só pode ser usado com o e-mail ${p_.to}.`;
  const text = `${intro}

Para aceitar o convite e criar sua senha, use o link:
${p_.link}

${expiry}
${SECURITY_NOTE}
${textFooter(`Você recebeu este e-mail porque ${p_.inviterName} convidou este endereço para a ${p_.orgName}.`)}`;
  const html = layout({
    preheader: `Convite para a ${p_.orgName} na ${NAME}.`,
    title: `Você foi convidado para a ${p_.orgName}`,
    body: `${p(esc(intro))}${button(p_.link, "Aceitar convite")}${small(esc(expiry))}${small(esc(SECURITY_NOTE))}`,
    reason: `Você recebeu este e-mail porque ${p_.inviterName} convidou este endereço para a ${p_.orgName}.`,
  });
  return { orgId: p_.orgId, to: p_.to, kind: p_.resend ? "invitation_resend" : "invitation", subject, text, html, invitationId: p_.invitationId };
}

/** 5. Recuperação de senha · 3/4. Primeiro acesso / criação de senha. */
export function passwordResetEmail(p_: { to: string; link: string; firstAccess: boolean; ttlMinutes?: number }): OutgoingEmail {
  const ttl = p_.ttlMinutes ?? 60;
  const ttlLabel = ttl >= 60 && ttl % 60 === 0 ? `${ttl / 60} hora${ttl === 60 ? "" : "s"}` : `${ttl} minutos`;
  const subject = p_.firstAccess ? `Crie sua senha da ${NAME}` : `Redefinição de senha da ${NAME}`;
  const title = p_.firstAccess ? "Crie sua senha de acesso" : "Redefina sua senha";
  const intro = p_.firstAccess
    ? "Seu acesso está pronto. Use o botão abaixo para criar sua senha."
    : "Recebemos um pedido para redefinir sua senha. Se não foi você, ignore este e-mail: sua senha atual continua valendo.";
  const expiry = `O link vale por ${ttlLabel} e só pode ser usado uma vez.`;
  const text = `${title}

${intro}

${p_.link}

${expiry}
${SECURITY_NOTE}
${textFooter("Você recebeu este e-mail porque houve um pedido de acesso para este endereço.")}`;
  const html = layout({
    preheader: p_.firstAccess ? "Crie sua senha para entrar na Vera.ia." : "Link para redefinir sua senha.",
    title,
    body: `${p(esc(intro))}${button(p_.link, p_.firstAccess ? "Criar minha senha" : "Redefinir senha")}${small(esc(expiry))}${small(esc(SECURITY_NOTE))}`,
    reason: "Você recebeu este e-mail porque houve um pedido de acesso para este endereço.",
  });
  return { orgId: null, to: p_.to, kind: p_.firstAccess ? "first_access" : "password_reset", subject, text, html };
}

/** 6. Confirmação de e-mail. */
export function emailConfirmationEmail(p_: { to: string; link: string; expiresHours: number }): OutgoingEmail {
  const subject = `Confirme seu e-mail na ${NAME}`;
  const expiry = `O link vale por ${p_.expiresHours} hora${p_.expiresHours === 1 ? "" : "s"}.`;
  const text = `Confirme que este endereço é seu para concluir o acesso:\n\n${p_.link}\n\n${expiry}\n${textFooter("Você recebeu este e-mail porque este endereço foi cadastrado na Vera.ia.")}`;
  const html = layout({
    preheader: "Confirme seu endereço de e-mail.",
    title: "Confirme seu e-mail",
    body: `${p("Confirme que este endereço é seu para concluir o acesso.")}${button(p_.link, "Confirmar e-mail")}${small(esc(expiry))}`,
    reason: "Você recebeu este e-mail porque este endereço foi cadastrado na Vera.ia.",
  });
  return { orgId: null, to: p_.to, kind: "email_confirmation", subject, text, html };
}

/** 8. Boas-vindas (após o primeiro acesso). */
export function welcomeEmail(p_: { orgId: string; to: string; name: string; orgName: string; link: string }): OutgoingEmail {
  const subject = `Boas-vindas à ${NAME}`;
  const first = p_.name.split(/\s+/)[0] || p_.name;
  const intro = `${first}, seu acesso à ${p_.orgName} está ativo. Pergunte sobre coberturas, exclusões, franquias e carências: cada resposta mostra o documento, a página e o trecho de onde veio.`;
  const text = `${intro}\n\nEntrar: ${p_.link}\n\n${SECURITY_NOTE}\n${textFooter(`Você recebeu este e-mail porque concluiu o primeiro acesso na ${p_.orgName}.`)}`;
  const html = layout({
    preheader: "Seu acesso está ativo.",
    title: `Boas-vindas à ${NAME}`,
    body: `${p(esc(intro))}${button(p_.link, "Entrar na Vera.ia")}${small(esc(SECURITY_NOTE))}`,
    reason: `Você recebeu este e-mail porque concluiu o primeiro acesso na ${p_.orgName}.`,
  });
  return { orgId: p_.orgId, to: p_.to, kind: "welcome", subject, text, html };
}

/** 9. Confirmação de alteração de senha. */
export function passwordChangedEmail(p_: { to: string; recoverLink: string; when: Date }): OutgoingEmail {
  const subject = `Sua senha da ${NAME} foi alterada`;
  const when = p_.when.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  const intro = `A senha da sua conta foi alterada em ${when} (horário de Brasília) e as outras sessões foram encerradas.`;
  const warn = "Se não foi você, peça uma nova senha agora mesmo pelo link abaixo e avise quem administra a sua corretora.";
  const text = `${intro}\n\n${warn}\n${p_.recoverLink}\n${textFooter("Você recebeu este e-mail por segurança, após uma alteração na sua conta.")}`;
  const html = layout({
    preheader: "Aviso de segurança da sua conta.",
    title: "Sua senha foi alterada",
    body: `${p(esc(intro))}${p(esc(warn))}${button(p_.recoverLink, "Não fui eu")}`,
    reason: "Você recebeu este e-mail por segurança, após uma alteração na sua conta.",
  });
  return { orgId: null, to: p_.to, kind: "password_changed", subject, text, html };
}

export function gapResolvedEmail(p_: { orgId: string; to: string; question: string; link: string }): OutgoingEmail {
  const subject = `Sua dúvida agora tem resposta na ${NAME}`;
  const text = `A dúvida "${p_.question}" foi respondida por quem administra a corretora e já aparece nas consultas, com a fonte: ${p_.link}\n${textFooter("Você recebeu este e-mail porque fez esta pergunta na plataforma.")}`;
  const html = layout({
    preheader: "Uma dúvida sua foi respondida.",
    title: "Sua dúvida tem resposta",
    body: `${p(`A dúvida <b>“${esc(p_.question)}”</b> foi respondida por quem administra a corretora e já aparece nas consultas, com a fonte.`)}${button(p_.link, "Consultar agora")}`,
    reason: "Você recebeu este e-mail porque fez esta pergunta na plataforma.",
  });
  return { orgId: p_.orgId, to: p_.to, kind: "gap_resolved", subject, text, html };
}

export function appUrl(path: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path}`;
}
