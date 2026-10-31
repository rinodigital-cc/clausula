"use server";

import { redirect } from "next/navigation";
import { getCurrentUser, login, logout, startSession, switchOrganization } from "@/lib/auth/web";
import { acceptInvitation, registerAndAccept } from "@/lib/domain/members";
import { requestPasswordReset, resetPassword } from "@/lib/domain/account";
import { withBootstrap } from "@/lib/db/client";

export type FormState = { error?: string; ok?: boolean; message?: string } | undefined;

function safeNext(raw: FormDataEntryValue | null): string | null {
  const v = typeof raw === "string" ? raw : "";
  // Só caminhos internos: impede redirecionamento aberto para outro site.
  return v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") ? v : null;
}

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const r = await login(String(form.get("email") ?? ""), String(form.get("senha") ?? ""));
  if (!r.ok) return { error: r.error };
  redirect(safeNext(form.get("next")) ?? (await landingFor()));
}

/** Para onde vai cada pessoa depois de entrar. */
async function landingFor(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) return "/entrar";
  if (!user.activeOrgId) return user.isPlatformAdmin ? "/plataforma" : "/sem-acesso";
  const [m] = await withBootstrap("destino após login", (db) =>
    db<{ role: string }[]>`SELECT role FROM memberships WHERE user_id = ${user.userId} AND org_id = ${user.activeOrgId} AND status = 'active'`,
  );
  return m?.role === "member" ? "/app" : "/app";
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/entrar?saiu=1");
}

export async function requestResetAction(_: FormState, form: FormData): Promise<FormState> {
  await requestPasswordReset(String(form.get("email") ?? ""));
  return {
    ok: true,
    message: "Se houver uma conta com este e-mail, enviamos um link para redefinir a senha. Ele vale por 1 hora.",
  };
}

export async function resetAction(_: FormState, form: FormData): Promise<FormState> {
  const token = String(form.get("token") ?? "");
  const senha = String(form.get("senha") ?? "");
  if (senha !== String(form.get("confirmacao") ?? "")) return { error: "As senhas não conferem." };
  try {
    const { userId } = await resetPassword(token, senha);
    await startSession(userId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  redirect(await landingFor());
}

export async function registerInviteAction(_: FormState, form: FormData): Promise<FormState> {
  const token = String(form.get("token") ?? "");
  const senha = String(form.get("senha") ?? "");
  if (senha !== String(form.get("confirmacao") ?? "")) return { error: "As senhas não conferem." };
  try {
    const { userId, orgId } = await registerAndAccept({ token, name: String(form.get("nome") ?? ""), password: senha });
    await startSession(userId, orgId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  redirect("/app?bemvindo=1");
}

export async function acceptLoggedInAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Entre na sua conta para aceitar o convite." };
  try {
    const { orgId } = await acceptInvitation(String(form.get("token") ?? ""), user.userId);
    await switchOrganization(orgId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  redirect("/app?bemvindo=1");
}

export async function switchOrgAction(form: FormData): Promise<void> {
  const ok = await switchOrganization(String(form.get("orgId") ?? ""));
  redirect(ok ? "/app" : "/sem-acesso");
}
