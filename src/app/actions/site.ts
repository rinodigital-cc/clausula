"use server";

import { headers } from "next/headers";
import { submitLead } from "@/lib/domain/leads";

export type LeadState = { ok?: boolean; errors?: Record<string, string>; message?: string } | undefined;

export async function leadAction(_: LeadState, form: FormData): Promise<LeadState> {
  const h = await headers();
  const s = (k: string) => String(form.get(k) ?? "");
  try {
    const r = await submitLead({
      name: s("nome"),
      email: s("email"),
      company: s("corretora"),
      phone: s("telefone"),
      teamSize: s("equipe"),
      interest: s("interesse"),
      message: s("mensagem"),
      consent: form.get("consentimento") === "on",
      website: s("website"),
      startedAt: Number(s("inicio")) || undefined,
      ip: (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null,
      userAgent: h.get("user-agent"),
      path: "/contato",
    });
    if (r.ok) return { ok: true };
    return { errors: r.errors, message: r.message };
  } catch (e) {
    console.error(JSON.stringify({ level: "error", event: "lead_failed", message: (e as Error).message }));
    return { message: "Não conseguimos registrar seu contato agora. Tente novamente em alguns minutos." };
  }
}
