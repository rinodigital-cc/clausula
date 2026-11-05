import "server-only";
import { createClient } from "@supabase/supabase-js";
import { authConfig } from "./config";

/** Apenas Auth Admin; nunca usa service_role para consultar dados de corretoras. */
export function authAdmin() {
  const { url } = authConfig();
  const key = process.env.SUPABASE_AUTH_SECRET_KEY;
  if (!key) throw new Error("Provisionamento de Auth indisponível neste ambiente.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin;
}

/** Mantém o UUID interno. Nunca associa contas só por e-mail nem sobrescreve senha existente. */
export async function provisionIdentity(user: { id: string; email: string }, password?: string) {
  const admin = authAdmin();
  const existing = await admin.getUserById(user.id);
  if (existing.data.user) {
    if (existing.data.user.email?.toLowerCase() !== user.email.toLowerCase()) throw new Error("Identidade divergente; requer revisão administrativa.");
    return false;
  }
  if (existing.error && existing.error.status !== 404 && existing.error.code !== "user_not_found") throw existing.error;
  const { data, error } = await admin.createUser({ id: user.id, email: user.email, password, email_confirm: !!password });
  if (error || data.user?.id !== user.id) throw new Error("Não foi possível provisionar a identidade com segurança.");
  return true;
}
