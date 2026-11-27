/** Cookie curto (10 min, httpOnly, restrito à página) com o resultado da criação de corretora. */
export const CREATED_COOKIE = "vera_corretora_criada";
export type CreatedPayload = { name: string; email: string; link: string; orgId: string; accepted: boolean; provider: boolean };
