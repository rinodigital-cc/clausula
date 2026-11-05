# Supabase Auth — homologação

Implementação na branch `apoia/redesign-fluida`. Produção não deve receber esta ativação.

## Arquitetura e preservação

- `AUTH_PROVIDER=legacy` é o padrão; `supabase` ativa a integração por ambiente.
- A configuração recusa `VERCEL_ENV=production` e projetos diferentes de `cvhujdexzvtjlnqnffai`.
- Supabase autentica. `public.users`, `memberships`, `platform_admins`, `sessions` e as policies existentes continuam sendo a fonte de autorização. Nenhuma tabela ou policy foi modificada.
- O UUID do Auth precisa ser exatamente o UUID de `public.users`. Não há vínculo automático por e-mail ou por `user_metadata`.
- O cookie interno continua guardando a corretora ativa e permitindo revogação imediata no banco. Ele só é aceito junto de uma identidade validada com `auth.getUser()` e UUID coincidente.
- Papéis e estado da corretora continuam sendo consultados por `resolveSession`; consultas continuam usando `withTenant` e o papel com RLS. Chave administrativa de Auth nunca substitui a conexão de dados.
- Contas legadas são provisionadas com o mesmo UUID apenas após validação da senha scrypt. Identidade existente nunca tem senha sobrescrita por esse caminho. Recuperação pode provisionar a identidade sem senha para permitir envio do link. Conflitos exigem revisão administrativa.
- Convites mantêm o vínculo interno; criação da identidade ocorre antes do commit. Se a transação falhar depois da chamada externa, pode sobrar uma identidade Auth sem perfil. Ela não obtém acesso; deve ser conciliada administrativamente antes de repetir o convite. Não existe transação distribuída entre Postgres e Auth.
- Logout revoga a sessão interna e encerra a sessão Supabase local. Redefinição exige identidade validada e recibo de uso único, invalida sessões internas e revoga os refresh tokens das outras sessões.

## Configuração do preview

Somente target `preview`, branch `apoia/redesign-fluida`:

- `AUTH_PROVIDER=supabase`
- `SUPABASE_AUTH_URL=https://cvhujdexzvtjlnqnffai.supabase.co`
- `SUPABASE_AUTH_PUBLISHABLE_KEY`: chave pública do projeto de homologação.
- `SUPABASE_AUTH_SECRET_KEY`: segredo de servidor do mesmo projeto, necessário para provisionamento/migração/convites. Nunca `NEXT_PUBLIC_*`.
- `DATABASE_URL`, `BOOTSTRAP_DATABASE_URL`, `PLATFORM_DATABASE_URL`, `WORKER_DATABASE_URL`, `PUBLIC_DATABASE_URL`: conexões com os respectivos papéis restritos definidos em `db/setup-login-roles.ts`. Nunca usar `postgres` ou `service_role` para consultas de tenant.
- `APP_URL`: URL estável do preview, não URL de um deployment antigo.

No Supabase Auth, permitir o redirect exato `<APP_URL>/auth/callback`. O fluxo padrão usa PKCE e precisa abrir o link no mesmo navegador. Alternativamente, template de recuperação pode usar `<APP_URL>/auth/callback?token_hash={{ .TokenHash }}&type=recovery`; o callback aceita somente o tipo `recovery` e nunca um destino externo. Configurar SMTP para testar entrega real. Não configurar URL de produção.

## Evidência e pendências — 2026-11-05

- Projeto de homologação encontrado ativo. Contagens consultadas: zero usuários públicos, zero usuários Auth, zero memberships e zero organizações.
- As únicas variáveis inicialmente encontradas no Vercel eram APP_URL e PUBLIC_SITE_URL. Não havia conexões de banco nem segredo administrativo de Auth.
- Build, TypeScript, lint e 32 casos existentes passaram. Sete testes adicionais exercitam o proxy com o SDK real e respostas HTTP simuladas: visitante, JWT forjado, identidade validada, refresh revogado/limpeza de cookie, endpoints públicos, bloqueio de produção e modo legado. **Isso não equivale a E2E em homologação.**
- Suítes SQL/P0 existentes apagam dados e só aceitam banco local descartável; não foram executadas contra homologação.
- Login/logout/recuperação com contas reais de teste e isolamento entre corretoras ainda dependem das credenciais/configuração acima. Não considerar a integração homologada até concluir essa matriz.
- Advisors apontaram avisos preexistentes de search_path mutável e extensões no schema público; não foram alterados nesta integração.

## Matriz obrigatória antes da aprovação

1. Criar duas corretoras fictícias e identidades com os mesmos UUIDs dos perfis; testar owner, admin, member e operador de plataforma.
2. Login válido/inválido, conta sem perfil, usuário removido e corretora suspensa.
3. Logout e reuso do cookie anterior; refresh expirado/revogado; cookies de identidades diferentes.
4. Recuperação recebida via e-mail, link vencido, reutilizado e de outro usuário; senha antiga recusada e demais sessões encerradas.
5. `/app`, `/admin`, `/plataforma` e download privado sem autenticação e com papel insuficiente; ações diretas também devem negar.
6. Troca de corretora só com vínculo ativo; membro da corretora A não lê documentos/conversas da B.
7. Comparar IDs, vínculos, permissões, policies e dados antes/depois. Sem reset, truncate ou migração destrutiva.

Rollback do preview: `AUTH_PROVIDER=legacy`, seguido de novo deploy da branch. Contas que já redefiniram a senha no Supabase precisarão de recuperação pelo fluxo legado; não reativar hashes antigos. Nenhuma mudança de produção está autorizada por este documento.
