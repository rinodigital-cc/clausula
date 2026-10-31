# ApoIA Seguro — implantação de homologação com Codex

## Status
O pacote contém Next.js, um worker contínuo e PDFs em disco. Este compose exige **host Docker com volume persistente**, proxy HTTPS e PostgreSQL com pgvector acessível. A Vercel isoladamente não executa toda essa arquitetura.

## Preflight
1. Verifique o estado do Supabase e a compatibilidade das cinco roles (`docs/HANDOFF.md`). Não rode a suíte de integração contra dados reais: ela faz TRUNCATE.
2. Configure `.env.deploy` fora do Git; use os nomes de `.env.example`. `APP_URL` deve apontar para a URL HTTPS de homologação. Não imprima credenciais em logs.
3. Execute `npm ci`, `npm run typecheck` e `npm run build` em um CI com acesso ao registro npm.
4. Provisionar migrações e roles com credenciais de dono de schema em banco isolado, auditando RLS antes de liberar acesso.
5. Construa os serviços Docker: `docker compose -f compose.homologacao.yml build`.
6. No host HTTPS, suba `docker compose -f compose.homologacao.yml up -d`.
7. Execute smoke tests de autenticação, convite, isolamento entre duas corretoras, upload de PDF, processamento pelo worker, resposta literal e citação antes de divulgar o link.

## Não realizar
- Não colocar `.env.deploy` ou chaves no repositório.
- Não expor o endpoint web sem TLS e autenticação valida.
- Não usar Supabase Storage como substituto de `STORAGE_DIR` sem alterar a implementação de `src/lib/storage.ts` e worker.
- Não prometer e-mails transacionais até configurar `EMAIL_TRANSPORT` de verdade.
- Não usar Vercel para o worker contínuo, nem gravar documentos em seu filesystem efêmero.

## Infra pendente
Host Docker compatível ou reengenharia para R2/S3 + jobs agendados/filas, DNS de ambiente de teste, secrets e monitoramento de erros.

## Preflight automatizado — adicionado em 31/10/2026

Execute `node scripts/preflight-homologacao.mjs` no diretório do aplicativo, com o ambiente de homologação configurado. O script informa dependências/configurações ausentes sem imprimir segredos. Ele não prova que `npm test` ou `npm run build` passaram.

**Descobertas da auditoria conectada:** o Supabase `eyfhdoyvmywdzknpxxqn` voltou a `ACTIVE_HEALTHY`, mas tem 16 tabelas de um schema anterior (`organizations`, `memberships`, `documents` etc.). **NÃO** executar as migrações desse aplicativo diretamente nele sem comparar o schema e definir uma estratégia de migração sem perda de dados. `npm ci` não terminou no ambiente da auditoria. O projeto Vercel `apoio-seguro` ainda aponta para Vite e tem zero deploys; não publicar essa arquitetura sem migrar o armazenamento para object storage e o worker para infraestrutura compatível. O painel `/plataforma` continua pendente. Usar staging separado antes de produção.
