import "server-only";
import { cookies } from "next/headers";

/**
 * Mensagem de retorno de uma ação (“flash”). Vai num cookie de vida curta em
 * vez de na URL: assim ninguém consegue montar um link com texto arbitrário
 * exibido como se fosse do sistema.
 */
const NAME = "apoia_flash";

export type Flash = { tone: "success" | "danger" | "info"; text: string };

export async function setFlash(tone: Flash["tone"], text: string): Promise<void> {
  (await cookies()).set(NAME, JSON.stringify({ tone, text: text.slice(0, 400) }), {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.APP_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: 20,
  });
}

export async function readFlash(): Promise<Flash | null> {
  const raw = (await cookies()).get(NAME)?.value;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Flash;
    if (typeof v?.text !== "string" || !["success", "danger", "info"].includes(v.tone)) return null;
    return v;
  } catch {
    return null;
  }
}
