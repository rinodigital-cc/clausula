# ApoIA Seguro — plano e status da homologacao real

> Atualizado em 2026-10-31. Este documento separa prova em staging de testes locais.
> Nao executar migracoes do aplicativo no schema public do Supabase existente.

## Infraestrutura confirmada por integrações conectadas

| Item | Estado verificado |
| --- | --- |
| Repositorio | rinodigital-cc/clausula, PR #1, branch apoia/redesign-fluida |
| Github Actions | CI verde com testes de isolamento, integracao, E2E e build |
| Vercel | Projeto apoio-seguro, framework Next.js, preview READY |
| Segredos de runtime Vercel | NENHUMA variavel configurada no projeto |
| Supabase | Projeto clausula ativo, sa-east-1, PostgreSQL 17, pgvector instalado |
| Dados PostgreSQL | 16 tabelas public existentes de uma versao anterior; schema incompativel com as 14 migracoes |
| Armazenamento de documentos | Implementacao em disco local, sem volume persistente entre Vercel e worker |
| Worker | Processo continuo em services/worker/index.ts, nao implantado |
| Provedor de IA | Sem ANTHROPIC_API_KEY na Vercel; somente modo literal foi validado localmente |
| E-mail | Sem RESEND_API_KEY e EMAIL_FROM verificado na Vercel; testes locais usaram EMAIL_TRANSPORT=file |

**Conclusao atual:** existe preview compilado, mas NAO existe homologacao operacional para corretores.

## Ponto de decisao de infraestrutura

A implementacao atual requer web + worker continuo com volume compartilhado (STORAGE_DIR) e Postgres/pgvector. Um deployment Next.js em Vercel nao fornece, por si so, esse worker e esse volume persistente. Ha duas rotas viaveis:

A. Staging Docker: um host com Docker e HTTPS, dois servicos (web e worker), volume privado persistente e banco separado com Postgres + pgvector. Requer host disponivel e credenciais fornecidas por mecanismo seguro, sem expor chaves no repositorio.

B. Staging serverless: manter Next.js na Vercel, substituir armazenamento local por object storage privado, e remodelar a fila do worker para jobs/cron/queue com retries idempotentes. Somente depois configurar Postgres isolado e credenciais com menor privilegio.

Nenhuma dessas rotas deve usar o schema legado atual como se fosse compativel.

## Criterios de aceite P0 — nao negociaveis

1. **Banco** — ambiente segregado, 14 migracoes por checksum, cinco roles runtime, RLS validada; nao executar suites com TRUNCATE no Supabase conectado.
2. **Autenticacao** — operador cria corretora, convite e redefinicao recebidos em caixa real de teste, login, logout, revogacao de sessao e suspensao.
3. **Isolamento** — usuario da corretora B nao ve dados nem consegue ler PDF pertencente a A; acesso a plataforma bloqueado para usuario normal.
4. **Documento** — upload de PDF textual por admin da corretora A, arquivo persistido fora do filesystem efemero, worker processa, paginas e clausulas recuperaveis, reprocessamento e erro de PDF digitalizado tratados.
5. **Consulta** — pergunta com fonte, visualizacao do documento e pagina corretas; pergunta sem evidencia nao inventa clausula. Modo IA generativa testado com provedor real e validador de citacao. Fallback extrativo claro ao usuario.
6. **E-mail** — convite, recuperacao de senha e remetente validado com comprovante de entrega real; modo file nao conta.
7. **Operacao** — HTTPS, armazenamento privado, sem segredos expostos ao browser, limites de uso, observabilidade, backup, custo e reversao.
8. **UX** — aceite manual em desktop/mobile e acessibilidade; testes automatizados nao substituem teste com corretores.

## Primeiro smoke remoto (nao destrutivo)

Executar em um staging HTTPS (nao no dominio de producao):

    HOMOLOG_URL=https://HOST-DE-STAGING/ node scripts/homologacao-remota.mjs

O script verifica HTML publico e /api/saude com banco ativo. Ele NAO altera dados, nao usa e-mail e NAO atesta os criterios 2 a 8. Falha com status nao zero se nao houver URL ou banco conectado. Previews com protecao Vercel podem requerer VERCEL_AUTOMATION_BYPASS_SECRET injetado pelo provedor, sem imprimi-lo.

## Procedimento para aprovar a liberacao

- Provisionar infraestrutura de staging separada; NAO migrar o schema legado.
- Inserir segredos diretamente no provedor em Preview/Staging, nunca no Git.
- Rodar migracoes e preparar roles somente no banco novo e isolado.
- Executar smoke remoto, depois testes reais P0 envolvendo dois usuarios de corretoras distintas, PDF e e-mail de teste.
- Guardar evidencias de cada caso, inclusive modo generativo e citacoes.
- Revisar o PR #1; depois de aprovado, liberar primeiro a homologacao para corretores convidados. Nao associar o dominio principal a um backend incompleto.

## Bloqueios externos no momento desta auditoria

- Infraestrutura de staging persistente ainda nao provisionada.
- Banco atual possui schema legado; criar projeto/branch adicional pode gerar custo e exige verificacao/consentimento antes de contratar.
- Nao ha chaves reais de banco, Anthropic ou transacionais na Vercel.
- Worker e armazenamento persistente nao operam na Vercel atual.
- O Codex Cloud relatou bloqueio de proxy; GitHub Actions e GitHub conectado funcionam.

**Nunca afirmar que o produto completo esta homologado apenas porque o CI ou o deploy NEXT estao verdes.**
