/**
 * Redirecionamento com Location RELATIVO. Atrás de proxy/standalone o
 * request.url pode ser http://0.0.0.0:3000; um Location absoluto montado
 * a partir dele é bloqueado pela CSP (form-action 'self') e o usuário vê
 * o formulário "voltar vazio". Relativo resolve contra a origem real.
 */
export function relativeRedirect(path: string, status: 302 | 303 | 307 = 303, headers: HeadersInit = {}): Response {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Destino de redirecionamento inválido.");
  const h = new Headers(headers);
  h.set("Location", path);
  h.set("Cache-Control", "private, no-store");
  return new Response(null, { status, headers: h });
}
