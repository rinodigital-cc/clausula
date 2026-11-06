"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/auth/web";
import { ask, ConsultError, giveFeedback } from "@/lib/domain/consult";

export type AskState = { error?: string; question?: string } | undefined;

export async function askAction(_: AskState, form: FormData): Promise<AskState> {
  const { session } = await requireTenant("specialist.query");
  const question = String(form.get("pergunta") ?? "");
  const conversationId = String(form.get("conversa") ?? "") || null;
  const insurerId = String(form.get("seguradora") ?? "") || null;
  let target: string;
  try {
    const r = await ask(session, { question, conversationId, insurerId });
    target = `/app/consulta/${r.conversationId}?m=${r.messageId}#m-${r.messageId}`;
  } catch (e) {
    if (e instanceof ConsultError) return { error: e.message, question };
    console.error(JSON.stringify({ level: "error", event: "ask_failed", message: (e as Error).message }));
    // A pergunta é preservada no campo: falhar não pode custar a digitação.
    return { error: "Não consegui concluir a consulta agora. Sua pergunta foi mantida: tente novamente em instantes.", question };
  }
  redirect(target);
}

export async function feedbackAction(form: FormData): Promise<void> {
  const { session } = await requireTenant("specialist.query");
  const messageId = String(form.get("mensagem") ?? "");
  const conv = String(form.get("conversa") ?? "");
  await giveFeedback(session, {
    messageId,
    rating: String(form.get("avaliacao") ?? ""),
    comment: String(form.get("comentario") ?? ""),
  });
  revalidatePath(`/app/consulta/${conv}`);
  redirect(`/app/consulta/${conv}?m=${messageId}&obrigado=${messageId}#m-${messageId}`);
}
