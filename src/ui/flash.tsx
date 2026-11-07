import { readFlash } from "@/lib/flash";
import { Alert } from "@/ui/components";

/** Exibe o retorno da última ação (cookie de vida curta; ver lib/flash). */
export async function FlashMessage() {
  const f = await readFlash();
  if (!f) return null;
  return <Alert tone={f.tone === "danger" ? "danger" : f.tone === "success" ? "success" : "info"}>{f.text}</Alert>;
}
