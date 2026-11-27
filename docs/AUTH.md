# Autenticação e acesso — Vera.ia

Detalhes do Supabase Auth em homologação: `docs/SUPABASE_AUTH_HOMOLOGACAO.md` (continua válido).

## Fonte de verdade

- **Identidade:** Supabase Auth (homologação, `AUTH_PROVIDER=supabase`) ou legado (scrypt + cookie de sessão). Produção continua no legado: a configuração recusa `VERCEL_ENV=production`.
- **Autorização:** sempre no banco (`users`, `memberships`, `platform_admins`, `sessions`) com RLS por corretora. A chave de servidor do Auth nunca consulta dados de corretoras.

## Fluxo: cadastro de corretora → conta ativa

1. Operador da plataforma cria a corretora em `/plataforma/nova` (POST nativo, checagem de origem).
2. Uma transação grava corretora, assistente, seguradoras, convite de **owner** (token com hash, 7 dias) e o e-mail na caixa de saída. Duplicidade (mesmo nome + mesmo e-mail com convite pendente) é recusada.
3. Após o commit, o e-mail sai na hora pelo Resend. Se falhar, **o cadastro não é desfeito**: o e-mail fica pendente e é reenviado automaticamente; a tela mostra o link para envio manual.
4. O responsável abre `/convite/<token>`, informa nome e senha. Conta criada com o mesmo UUID no Supabase Auth, convite consumido (uso único, só para o e-mail convidado), boas-vindas enviadas.
5. O painel passa a mostrar **Conta ativa**.

O administrador nunca cria nem envia senha.

## Recuperação

`/recuperar` → resposta idêntica exista ou não a conta → limite de 3/h → link do Supabase (`generateLink`, 1 h) enviado pelo Resend → `/auth/callback?token_hash=…&type=recovery` → recibo interno de uso único → `/redefinir/<recibo>` → nova senha, sessões internas revogadas, outras sessões Supabase encerradas, aviso de **senha alterada** por e-mail.

Links inválidos, vencidos ou reutilizados voltam para `/recuperar?invalido=1`.

## Reenvio e expiração

- `/plataforma` e `/plataforma/corretoras/<id>`: **Enviar novo convite** invalida o anterior; limite de 1 a cada 2 min e 5 por dia por corretora.
- Convite vencido aparece como **Convite expirado**; o mesmo botão gera um novo.

## Proteções

- Rotas `/app`, `/admin`, `/plataforma` exigem sessão (proxy + verificação no servidor em cada página/ação).
- Usuário comum em `/plataforma` → `/sem-permissao`. Corretora B nunca lê dados da A (RLS; 47 casos SQL + integração).
- Rota pública antiga `/api/internal/send-admin-recovery` **removida** (disparava recuperação para um e-mail fixo).
