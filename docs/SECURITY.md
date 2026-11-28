# Segurança — Vera.ia (homologação)

| Tema | Como está |
|---|---|
| Segredos | Somente servidor (`RESEND_API_KEY`, `SUPABASE_AUTH_SECRET_KEY`, `*_DATABASE_URL`, `RESEND_WEBHOOK_SECRET`). Nenhum `NEXT_PUBLIC_*` sensível. `.env*` real fora do Git. |
| Banco | Cinco papéis com RLS (`app_user`, `app_bootstrap`, `app_platform`, `app_worker`, `app_public`). Operador da plataforma lê só **metadados** do envio (coluna a coluna), nunca corpo ou link. |
| Isolamento | `withTenant` + `current_org()`; testes: 47 SQL + 78 integração. |
| E-mail | Idempotência por mensagem; limites por chave opaca (hash, nunca o e-mail em claro); teto diário; logs sem corpo, link ou chave. |
| Webhook | Assinatura Svix (HMAC-SHA256, tolerância 5 min, comparação em tempo constante); sem segredo configurado a rota responde 404; eventos idempotentes por `svix-id`. |
| Formulários | POST nativo com checagem de `Origin`; redirecionamentos relativos (sem open redirect). |
| Recuperação | Resposta idêntica para e-mail existente ou não; 3/h; link 1 h, uso único; derruba sessões. |
| Diagnóstico | `/api/saude` mostra apenas modos (`direto/gateway`, `provedor/pendente`, `generativa/literal`), nunca valores. |
| Dependências | Next.js 16.4.6 (16.4.3 tinha vulnerabilidade conhecida que bloqueia o build). |

## Riscos conhecidos

1. **DB Gateway não é transacional.** Sem as 5 conexões diretas, `begin()` executa comandos separados; uma falha no meio pode deixar cadastro parcial. Agora é registrado (`db_gateway_non_atomic_transaction`) e aparece em `/api/saude` (`modo_banco`). Correção: configurar as conexões diretas no Preview.
2. A Edge Function `db-gateway` não está no repositório; consultas novas (migração 0018) dependem de ela repassar SQL com `SET LOCAL ROLE` como hoje.
3. Avisos preexistentes do Supabase (search_path mutável, extensões no schema public) não foram alterados.
