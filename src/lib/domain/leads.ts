import "server-only";
import { createHash } from "node:crypto";
import { withPublic } from "@/lib/db/client";

/**
 * Captação de interessados do site público. Destino real: tabela `leads`,
 * lida no painel da plataforma. O papel de banco do formulário só INSERE.
 */
export const CONSENT_VERSION = "2026-10-v1";
export const CONSENT_TEXT =
  "Autorizo a ApoIA Seguro a usar estes dados para entrar em contato sobre a plataforma. Posso pedir a exclusão a qualquer momento.";

export type LeadInput = {
  name: string;
  email: string;
  company?: string;
  phone?: string;
  teamSize?: string;
  interest?: string;
  message?: string;
  consent: boolean;
  website?: string; // armadilha para robôs: campo invisível que pessoa não preenche
  startedAt?: number; // tempo mínimo de preenchimento
  ip?: string | null;
  userAgent?: string | null;
  path?: string;
};

export type LeadResult = { ok: true } | { ok: false; errors: Record<string, string>; message?: string };

export async function submitLead(input: LeadInput): Promise<LeadResult> {
  const errors: Record<string, string> = {};
  const name = (input.name ?? "").trim();
  const email = (input.email ?? "").trim().toLowerCase();
  if (name.length < 2) errors.name = "Informe seu nome.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) errors.email = "Informe um e-mail válido.";
  if (!input.consent) errors.consent = "É preciso autorizar o contato para enviarmos a resposta.";
  const teamSize = input.teamSize && ["1", "2-5", "6-20", "21-50", "50+"].includes(input.teamSize) ? input.teamSize : null;
  const interest = ["demonstracao", "piloto", "contato"].includes(input.interest ?? "") ? input.interest! : "demonstracao";
  const phone = (input.phone ?? "").replace(/[^\d+()\s-]/g, "").trim().slice(0, 40) || null;
  if (Object.keys(errors).length) return { ok: false, errors };

  // Robô: responde como sucesso e descarta (não ensina o robô a contornar).
  const tooFast = input.startedAt && Date.now() - input.startedAt < 2500;
  if ((input.website ?? "").trim() !== "" || tooFast) return { ok: true };

  const salt = process.env.SESSION_SECRET ?? "apoia";
  const ipHash = input.ip ? createHash("sha256").update(salt + input.ip).digest("hex").slice(0, 32) : null;

  return withPublic(async (db) => {
    if (ipHash) {
      const [q] = await db<{ ok: boolean }[]>`SELECT consume_lead_quota(${ipHash}, 5) AS ok`;
      if (!q?.ok) return { ok: false, errors: {}, message: "Recebemos muitos envios deste endereço. Tente novamente em uma hora." };
    }
    await db`
      INSERT INTO leads (name, email, company, phone, team_size, interest, message, consent_at, consent_version,
                         source_path, ip_hash, user_agent)
      VALUES (${name.slice(0, 120)}, ${email}, ${(input.company ?? "").trim().slice(0, 160) || null}, ${phone}, ${teamSize},
              ${interest}, ${(input.message ?? "").trim().slice(0, 2000) || null}, now(), ${CONSENT_VERSION},
              ${(input.path ?? "/").slice(0, 200)}, ${ipHash}, ${(input.userAgent ?? "").slice(0, 300) || null})
    `;
    return { ok: true } as const;
  });
}
