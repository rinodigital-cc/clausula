/** Opt-in por ambiente. Nenhuma ativação implícita em produção. */
export function supabaseAuthEnabled(): boolean {
  return process.env.AUTH_PROVIDER === "supabase";
}

export function authConfig() {
  const url = process.env.SUPABASE_AUTH_URL;
  const key = process.env.SUPABASE_AUTH_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase Auth não configurado neste ambiente.");
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Esta integração está habilitada somente para homologação.");
  }
  if (new URL(url).origin !== "https://cvhujdexzvtjlnqnffai.supabase.co") {
    throw new Error("Supabase Auth deve apontar para o projeto de homologação.");
  }
  return { url, key };
}
