# ApoIA Seguro — passagem de bastão (para continuar e publicar pelo Codex)

Atualizado em 31/10/2026. Branch com tudo: **`apoia/redesign-fluida`**.

## 1. O que é

SaaS para corretoras de seguros. O corretor pergunta (cobertura, exclusão, carência, franquia) e a IA responde **só com base nos documentos da corretora**, mostrando o trecho exato de onde veio cada afirmação. Se a informação não está nos documentos, ela diz que não encontrou.

## 2. O que está pronto

| Área | Situação |
|---|---|
| Site público (`/`, `/contato`, `/privacidade`) | Pronto. Formulário de contato grava interessados (`leads`). Privacidade marcada como preliminar. |
| Acesso (`/entrar`, `/recuperar`, `/redefinir/[token]`, `/convite/[token]`) | Pronto. Senhas com hash, sessões, limite de tentativas. |
| Consulta (`/app`, `/app/consulta/[id]`) | Pronto. Trilha do raciocínio, afirmações ligadas à fonte, folha do documento com grifo, fio de evidência, avaliação. |
| Histórico, Documentos, Documento completo | Pronto. |
| Administração da corretora (`/admin/*`) | Pronto: visão geral, documentos (envio de PDF, reprocessar, versões), equipe e convites, seguradoras e produtos, perguntas sem resposta, avaliações. |
| Worker (ingestão de PDF + envio de e-mail) | Pronto (`npm run worker`). |
| Multiempresa com isolamento | Pronto: RLS forçado no Postgres, um usuário de banco por papel. 47 testes de isolamento. |
| Interface “Fluida” (design system v3) | Pronta em todas as telas acima. WCAG 2.2 AA sem violações no axe (12 telas). |
| **Painel da plataforma (`/plataforma`)** | Implementado na importação pelo Codex: criação, lista, suspensão/reativação, reemissão de convite e qualificação de interessados. Acesso restrito a administradores da plataforma. |

Testes: `npm test` roda typecheck + unitários do núcleo (27), proteções de banco/e-mail (2), isolamento (47) e integração (68). `npm run lint` e `npm run test:e2e` acrescentam lint e homologação no Chromium. Consulte `docs/CODEX-CLOUD.md` para comandos e `docs/HOMOLOGACAO.md` para resultados e limitações.

## 3. Histórico e importação

O ZIP descrevia branches de trabalhos anteriores, mas esse histórico não estava no remoto conectado. Antes da importação, `rinodigital-cc/clausula` tinha apenas `main`, no commit `57636ea`, com `README.md`. O código foi importado na branch `apoia/redesign-fluida`, preservando a main. Os documentos em `db/legacy-docs` são referências históricas, não evidência da execução atual.

## 4. Stack e arquitetura

- Next.js 16 (App Router, server actions, `output: "standalone"`), React 19, TypeScript estrito.
- PostgreSQL 16 com extensões `pgcrypto`, `citext`, `unaccent`, `pg_trgm`, `vector` (pgvector). Acesso com `postgres.js`.
- Isolamento: toda tabela de corretora tem RLS **forçado**. A aplicação nunca usa o dono do schema; usa 5 usuários de login, um por papel:
  - `apoia_app` → papel `app_user` (aplicação, sempre dentro de `withTenant`)
  - `apoia_bootstrap` → `app_bootstrap` (login, convite, criação de corretora)
  - `apoia_platform` → `app_platform` (painel da plataforma)
  - `apoia_worker` → `app_worker` (ingestão e e-mail)
  - `apoia_public` → `app_public` (formulário do site: só insere lead)
- IA: `services/ai/` (recuperação por texto + pesos, resposta, validação de ancoragem). Sem `ANTHROPIC_API_KEY`, roda em **modo literal** (frases do próprio documento). Com chave, a IA redige e o validador remove o que não confere com o documento.
- Arquivos (PDFs) em disco, em `STORAGE_DIR` (`src/lib/storage.ts`).
- Worker separado (`services/worker/index.ts`): fila de ingestão e fila de e-mails.

Pastas principais: `src/app` (telas e rotas), `src/lib/domain` (regras de negócio), `src/lib/auth`, `src/lib/authz/policy.ts` (permissões por papel), `src/ui` (componentes), `src/styles` (tokens e estilos), `services/ai`, `services/worker`, `db/migrations`, `tests`.

## 5. Rodar localmente

Requisitos: Node 22+, Docker local com acesso ao socket e Chromium para testes de navegador. Use o checkout existente; cada tarefa do Codex Cloud já é isolada, sem necessidade de worktree.

```bash
npm ci
npm run cloud:setup
node scripts/codex-cloud.mjs run npm run dev
# Outro terminal, no mesmo diretório:
node scripts/codex-cloud.mjs run npm run worker
```

`cloud:setup` cria somente um Postgres local descartável, gera credenciais aleatórias em `.env.codex.local` (ignorado), aplica migrações e configura os cinco logins. Nunca contém credenciais de produção. O helper desativa provedores externos de e-mail e IA para os testes locais.

```bash
npm run lint
node scripts/codex-cloud.mjs run npm test
npm run build
node scripts/codex-cloud.mjs run npm run test:e2e
```

As suítes SQL, P0 e E2E **apagam os dados do banco de testes**; exigem nome terminado em `_test`, endereço local e `ALLOW_TEST_DB_RESET=1`. As URLs de runtime devem apontar ao mesmo banco. Não use essas suítes contra dados reais.

O seed E2E recria contas e documentos marcados como SIMULAÇÃO. Para primeiro administrador de um ambiente externo, use o comando `plataforma:admin` em um terminal privado; o link exibido é uma credencial de primeiro acesso e não deve ir para logs públicos.

## 6. Publicar (produção)

Nada foi publicado. Precisa de:

1. **Postgres 16 gerenciado com pgvector** e permissão para criar as extensões acima (Neon, Supabase, Railway, Render ou RDS servem). Rodar `db:migrate` e `db:roles` com o usuário dono.
2. **Dois processos Node**: a aplicação web (`npm run build && npm start`, ou a imagem standalone) e o worker (`npm run worker`), sempre ligado.
3. **Disco persistente para `STORAGE_DIR`**, compartilhado entre web e worker. Hospedagens com volume (Railway, Render, Fly.io, VPS) funcionam como está. **Vercel não serve sem mudanças**: não tem worker contínuo nem disco persistente. Para Vercel, trocar `src/lib/storage.ts` por armazenamento de objetos (S3/R2) e o worker por uma fila/cron.
4. Variáveis de ambiente: use `.env.example` como referência; nunca ative `ALLOW_TEST_DB_RESET` fora do banco descartável local. `SESSION_SECRET` forte e único. `APP_URL` com https.
5. Domínio e HTTPS: `apoiaseguro.com.br` está registrado, mas DNS e e-mail **não** estão configurados.
6. E-mail real: conta Resend (ou outro provedor) com o domínio verificado; `EMAIL_TRANSPORT` e `RESEND_API_KEY`. Sem isso, convites e recuperação de senha ficam gravados e não saem.
7. IA: `ANTHROPIC_API_KEY` e, se quiser teto de gasto, `DAILY_BUDGET_BRL` e os preços `AI_PRICE_*`.

Checklist antes de abrir para clientes: `npm test` verde; `next build` sem erro; testar login, convite, envio de PDF, consulta e isolamento entre duas corretoras no ambiente publicado; revisar a página de privacidade com um advogado (está marcada como preliminar).

## 7. Design system “Fluida”

- Tokens: `src/styles/tokens.css`. Estilos de todos os componentes: `src/styles/globals.css`.
- Regra de cor: **azul** = marca, ações e o que a IA escreveu; **verde** = o que está no documento (trecho, número da fonte, grifo); **âmbar** = ressalva antes de responder ao cliente.
- Camada de evidência: `src/app/app/consulta/[id]/page.tsx` (trilha, resposta, afirmações, fontes, folha do documento) e `EvidenceThread.tsx` (fio entre a afirmação ativa e o grifo; decorativo, `aria-hidden`).
- Fontes auto-hospedadas (CSP não permite hosts externos): Inter 4.1 completa em `public/fonts` com `cv08` ativo (o I maiúsculo com serifa evita ler “ApolA”); Newsreader só para trecho de documento; JetBrains Mono para cláusula, página e datas.
- Marca: wordmark em SVG contornado (`src/ui/wordmark-data.ts`, gerado por `scripts/brand/gerar-wordmark.py`) e arquivos em `public/brand/apoia-ia/`. **O símbolo ainda é provisório.**

## 8. Regras que não podem ser quebradas

- Nenhum segredo no repositório (`.env.local` está no `.gitignore`).
- Nunca inventar telefone, e-mail, CNPJ, depoimento, logo de seguradora, cliente, preço ou métrica. Conteúdo de exemplo sempre marcado como **SIMULAÇÃO**.
- Migração aplicada não se edita: cria-se outra (`db/migrate.ts` confere o hash).
- Toda consulta ao banco feita pela aplicação passa por `withTenant` / `withBootstrap` / `withPlatform` / `withPublic`. Nunca usar `DATABASE_URL_ADMIN` em runtime.
- jsonb: gravar com `${JSON.stringify(x)}::text::jsonb` (teste J01 cobre).
- Resposta sem fonte não é resposta: o validador de ancoragem (`services/ai/nucleo.ts`) fica sempre ligado.

## 9. Pendências, em ordem

1. **Painel da plataforma**: implementado; concluir aceite pelos responsáveis do produto no staging externo.
2. **Hospedagem** conforme a seção 6 (incluir Dockerfile da web e do worker, ou a configuração da plataforma escolhida).
3. **E-mail real** com domínio verificado.
4. **Chave de IA** e revisão das respostas no modo com IA (até aqui, validado só no modo literal).
5. **Símbolo da marca** definitivo (o wordmark está pronto).
6. Página de privacidade revisada juridicamente; termos de uso.
7. Testes de ponta a ponta: implementados em `tests/e2e`; repetir o aceite em staging externo com os provedores reais após provisionamento.

## 10. Referências visuais

- Ambiente de teste navegável com as telas atuais (artefato no Claude): “ApoIA Seguro · Ambiente de teste”.
- Prompt para adaptar a interface: `docs/CODEX-PROMPT.md` (seção “Interface”).
