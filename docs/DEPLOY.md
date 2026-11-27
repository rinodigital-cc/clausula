# Deploy em homologação — Vera.ia

Produção não é tocada. Nada é promovido automaticamente. Sem merge na `main`.

## Branches

- `apoia/redesign-fluida` — base de referência (PR #1).
- `vera/email-convites-homologacao` — esta entrega, sobre a base, sem reescrever histórico. PR para `apoia/redesign-fluida`.

## Checklist antes do push

```bash
npm ci
npm run lint
npm run typecheck
node scripts/codex-cloud.mjs run npm test      # unitários, isolamento SQL, integração (banco local descartável)
node scripts/codex-cloud.mjs run npm run build
node scripts/codex-cloud.mjs run npm run test:e2e   # exige Chromium (roda no GitHub Actions)
```

## Migração 0018 no Supabase de homologação (`cvhujdexzvtjlnqnffai`)

Aditiva (só `ADD COLUMN`, tabelas e função novas). Aplicar com `npm run db:migrate` usando `DATABASE_URL_ADMIN` do projeto de homologação, **ou** no SQL Editor: colar `db/migrations/0018_email_delivery.sql` e, na mesma execução, registrar:

```sql
INSERT INTO schema_migrations (name, checksum)
VALUES ('0018_email_delivery.sql', 'dce816137ef21f67d2bc0119dc8ffbefc135ee9dedaceee381af43293f0b7d64');
```

Conferir antes: `SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 3;` deve terminar em `0017_gateway_uuid_permissions.sql`. Nunca rodar as suítes de teste (fazem TRUNCATE) contra o Supabase.

## Vercel (projeto `apoio-seguro`, somente ambiente Preview)

| Variável | Valor |
|---|---|
| `RESEND_API_KEY` | injetada pela integração Resend (não digitar) |
| `EMAIL_FROM` | `Vera.ia <acesso@mail.apoiaseguro.com.br>` |
| `EMAIL_TRANSPORT` | remover ou `resend` |
| `APP_URL` | `https://homolog.apoiaseguro.com.br` |
| `AUTH_PROVIDER` | `supabase` (já existente) |
| `SUPABASE_AUTH_SECRET_KEY` | necessária para a recuperação sair pelo Resend |
| `*_DATABASE_URL` (5) | recomendado: elimina o modo gateway não transacional |

## Domínio de homologação

1. Vercel → Domains → adicionar `homolog.apoiaseguro.com.br`, associado à branch de homologação (Preview).
2. Registro.br → `homolog` CNAME para o destino que a Vercel indicar.
3. Supabase Auth → URL Configuration → redirect permitido `https://homolog.apoiaseguro.com.br/auth/callback`.
4. Aguardar HTTPS e validar `GET /api/saude`.

## Validação pós-deploy

`/api/saude` deve retornar `ok:true`, `db:"ok"`, `email:"provedor"`, `versao` igual ao commit. Depois, roteiro de `docs/QA.md`.

## Rollback

- Código: Vercel → Deployments → *Instant Rollback* para o Preview anterior, ou `git revert` dos commits da branch.
- E-mail: remover `RESEND_API_KEY` do Preview → mensagens voltam a ficar pendentes (nada é perdido).
- Banco: a migração 0018 é aditiva e compatível com o código anterior; não precisa ser revertida.
