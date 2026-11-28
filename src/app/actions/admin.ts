"use server";

import { notifyProcessor } from "@/lib/processing";
import { deliverNow } from "@/lib/email/deliver";
import { workerPool } from "@/lib/db/client";
import { dispatchEmails, syncDeliveryStatus } from "../../../services/worker/email";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdmin, requireTenant } from "@/lib/auth/web";
import type { ActionState } from "@/ui/ActionForm";
import { setFlash } from "@/lib/flash";
import { ForbiddenError } from "@/lib/authz/policy";
import { reprocessVersion, setSourceActive, uploadDocument } from "@/lib/domain/documents";
import { changeMemberRole, inviteMember, removeMember, revokeInvite } from "@/lib/domain/members";
import { createInsurer, createProduct } from "@/lib/domain/catalog";
import { dismissGap, resolveGap } from "@/lib/domain/gaps";
import { reissueOwnerInvite, setBrokerageStatus, setLeadStatus } from "@/lib/domain/platform";

/**
 * Mensagem segura para a tela: erros de regra de negócio (Error simples,
 * escritos em português no domínio) aparecem como estão; erros técnicos
 * (banco, rede) viram uma mensagem genérica e vão para o log.
 */
function safeMessage(e: unknown): string {
  if (e instanceof ForbiddenError) return "Você não tem permissão para fazer isso.";
  const err = e as { name?: string; code?: string; message?: string };
  if (err && err.name === "Error" && !err.code && typeof err.message === "string" && err.message.length < 300) return err.message;
  console.error(JSON.stringify({ level: "error", event: "admin_action_failed", name: err?.name, code: err?.code, message: err?.message }));
  return "Não foi possível concluir agora. Tente novamente em instantes.";
}

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// ------------------------------------------------------------- biblioteca
export async function uploadAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { session } = await requireTenant("source.write");
  const file = form.get("arquivo");
  if (!(file instanceof File)) return { error: "Selecione um arquivo PDF." };
  let sourceId: string;
  try {
    const r = await uploadDocument(session, {
      file,
      title: s(form, "titulo") || file.name.replace(/\.pdf$/i, ""),
      insurerId: s(form, "seguradora") || null,
      productId: s(form, "produto") || null,
      docType: s(form, "tipo") || "condicoes_gerais",
      validFrom: s(form, "vigencia_inicio") || null,
      validUntil: s(form, "vigencia_fim") || null,
      rightsConfirmed: form.get("direitos") === "on",
      replaceSourceId: s(form, "substituir") || null,
    });
    sourceId = r.sourceId;
    await notifyProcessor();
  } catch (e) {
    return { error: safeMessage(e) };
  }
  revalidatePath("/admin/biblioteca");
  await setFlash("success", "Documento recebido. O processamento começa em instantes e a situação aparece abaixo.");
  redirect(`/admin/biblioteca/${sourceId}`);
}


/** Executa uma ação de botão: grava o retorno em flash e volta para a página. */
async function step(path: string, okText: string, fn: () => Promise<unknown>): Promise<never> {
  try {
    await fn();
    await setFlash("success", okText);
  } catch (e) {
    await setFlash("danger", safeMessage(e));
  }
  revalidatePath(path);
  redirect(path);
}

export async function reprocessAction(form: FormData): Promise<void> {
  const { session } = await requireTenant("source.write");
  await step(`/admin/biblioteca/${s(form, "documento")}`, "Reprocessamento na fila. A situação atualiza sozinha nesta tela.", async () => {
    await reprocessVersion(session, s(form, "versao"));
    await notifyProcessor();
  },
  );
}

export async function toggleSourceAction(form: FormData): Promise<void> {
  const { session } = await requireTenant("source.write");
  const active = s(form, "ativar") === "1";
  await step(
    `/admin/biblioteca/${s(form, "documento")}`,
    active ? "Documento reativado: volta a ser usado nas respostas." : "Documento desativado: deixa de ser usado nas respostas. As consultas antigas mantêm o trecho citado.",
    () => setSourceActive(session, s(form, "documento"), active),
  );
}

export async function revokeInviteAction(form: FormData): Promise<void> {
  const { session } = await requireTenant("member.manage");
  await step("/admin/equipe", "Convite cancelado. O link deixou de funcionar.", () => revokeInvite(session, s(form, "convite")));
}

export async function changeRoleAction(form: FormData): Promise<void> {
  const { session } = await requireTenant("member.manage");
  await step("/admin/equipe", "Papel atualizado.", () => changeMemberRole(session, { userId: s(form, "usuario"), role: s(form, "papel") }));
}

export async function removeMemberAction(form: FormData): Promise<void> {
  const { session } = await requireTenant("member.manage");
  await step("/admin/equipe", "Acesso removido. As sessões abertas dessa pessoa foram encerradas.", async () => {
    if (s(form, "confirmar") !== "REMOVER") throw new Error("Para remover, digite REMOVER no campo de confirmação.");
    await removeMember(session, s(form, "usuario"));
  });
}

export async function dismissGapAction(form: FormData): Promise<void> {
  const { session } = await requireTenant("gap.manage");
  await step("/admin/lacunas", "Lacuna descartada.", () => dismissGap(session, s(form, "lacuna")));
}

export async function brokerageStatusAction(form: FormData): Promise<void> {
  const actor = await requirePlatformAdmin();
  await step("/plataforma", "Situação da corretora atualizada.", () => setBrokerageStatus(actor, s(form, "corretora"), s(form, "situacao")));
}

export async function leadStatusAction(form: FormData): Promise<void> {
  const actor = await requirePlatformAdmin();
  await step("/plataforma/interessados", "Situação do interessado atualizada.", () =>
    setLeadStatus(actor, s(form, "interessado"), s(form, "situacao")),
  );
}

export async function inviteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { session } = await requireTenant("member.manage");
  try {
    const email = s(form, "email");
    const r = await inviteMember(session, { email, role: s(form, "papel") || "member" });
    const delivery = await deliverNow([r.emailId]);
    revalidatePath("/admin/equipe");
    const to = email.toLowerCase();
    return {
      ok: delivery.accepted
        ? `Convite enviado para ${to}. Ele vale por 7 dias. Se a pessoa não encontrar o e-mail, copie o link abaixo.`
        : delivery.provider
          ? `Convite criado para ${to} e na fila de envio (nova tentativa automática). Ele vale por 7 dias; o link abaixo também funciona.`
          : `Convite criado para ${to}. Ele vale por 7 dias. Este ambiente ainda não envia e-mail: envie o link abaixo para a pessoa.`,
      link: r.link,
      at: Date.now(),
    };
  } catch (e) {
    return { error: safeMessage(e) };
  }
}

export async function createInsurerAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { session } = await requireTenant("catalog.manage");
  try {
    await createInsurer(session, s(form, "nome"));
  } catch (e) {
    return { error: safeMessage(e) };
  }
  revalidatePath("/admin/catalogo");
  return { ok: "Seguradora adicionada.", at: Date.now() };
}

export async function createProductAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { session } = await requireTenant("catalog.manage");
  try {
    await createProduct(session, { insurerId: s(form, "seguradora"), name: s(form, "nome"), line: s(form, "ramo") });
  } catch (e) {
    return { error: safeMessage(e) };
  }
  revalidatePath("/admin/catalogo");
  return { ok: "Produto adicionado.", at: Date.now() };
}

// ----------------------------------------------------------------- lacunas

export async function resolveGapAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { session } = await requireTenant("gap.manage");
  try {
    await resolveGap(session, {
      gapId: s(form, "lacuna"),
      title: s(form, "titulo"),
      answer: s(form, "resposta"),
      insurerId: s(form, "seguradora") || null,
    });
  } catch (e) {
    return { error: safeMessage(e) };
  }
  revalidatePath("/admin/lacunas");
  await setFlash("success", "Pergunta respondida. A resposta já entra nas consultas como conhecimento interno, e quem perguntou foi avisado.");
  redirect("/admin/lacunas");
}

export async function reissueOwnerAction(_: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requirePlatformAdmin();
  try {
    const { link, emailId } = await reissueOwnerInvite(actor, s(form, "corretora"), s(form, "email"));
    const delivery = await deliverNow([emailId]);
    revalidatePath("/plataforma");
    const ok = delivery.accepted
      ? "Novo convite enviado: o provedor aceitou o e-mail. O anterior deixou de valer."
      : delivery.provider
        ? "Novo convite gerado e na fila de envio (nova tentativa automática). O anterior deixou de valer."
        : "Novo convite gerado; o anterior deixou de valer. Este ambiente não tem provedor de e-mail: copie o link e envie por um canal seguro.";
    return { ok, link, at: Date.now() };
  } catch (e) {
    return { error: safeMessage(e) };
  }
}

export async function refreshDeliveriesAction(): Promise<void> {
  await requirePlatformAdmin();
  await step("/plataforma", "Situação dos envios atualizada com o provedor.", async () => {
    const pool = workerPool();
    await dispatchEmails(pool, 10);
    await syncDeliveryStatus(pool, 10);
  });
}

export async function retryProcessingAction(): Promise<void> {
  await requirePlatformAdmin();
  await step("/plataforma", "Fila acionada. Acompanhe a situação dos documentos.", () => notifyProcessor(true));
}
