# Importa ApoIA Seguro e valida homologação Fluida

O repositório tinha apenas README na main. Esta mudança importa o aplicativo recebido em ZIP para `apoia/redesign-fluida`, preservando a main e as 14 migrações originais.

Inclui site, autenticação, consulta com fonte, histórico, biblioteca, administração, worker de PDFs/e-mails e assets. Completa o painel da plataforma para criar corretoras, suspender/reativar, reemitir convites e qualificar interessados, usando as guardas, domínio e estilos existentes.

Corrige o armazenamento compartilhado entre standalone e worker, prepara os assets do standalone, ajusta efeitos React e seleção da afirmação ativa e remove `@ts-nocheck` da suíte herdada. Adiciona lint, CI e dez cenários E2E. As suítes destrutivas exigem banco local descartável; o transporte de e-mail em arquivo não usa o provedor mesmo com chave configurada.

Validação local: instalação limpa por lockfile; TypeScript e lint; 29 testes unitários; 47 testes de isolamento; 68 de integração; build standalone; 10/10 cenários Chromium e axe sem violações nos critérios A/AA selecionados em sete telas. Comandos e limitações em `docs/CODEX-CLOUD.md` e `docs/HOMOLOGACAO.md`.

Sem arquivos de ambiente reais, chaves, dependências instaladas ou dados de clientes. `.env.example` é um modelo; as fixtures são SIMULAÇÃO. Não houve deploy externo, alteração de DNS ou de banco remoto. Staging, e-mail real, revisão do modo IA e revisão jurídica continuam pendentes.
