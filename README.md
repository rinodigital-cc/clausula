# ApoIA Seguro

Plataforma de IA para corretoras de seguros. As respostas usam os documentos da corretora e mostram as fontes; sem evidência, o sistema informa que não encontrou a resposta.

Next.js 16, React 19, TypeScript, PostgreSQL 16/pgvector, worker contínuo de PDFs e e-mails e armazenamento compartilhado em disco.

```bash
npm ci
npm run cloud:setup
node scripts/codex-cloud.mjs run npm run dev
# Em outro terminal:
node scripts/codex-cloud.mjs run npm run worker
```

O preparo cria somente um banco local descartável e credenciais aleatórias ignoradas pelo Git. Não conecta a bancos remotos e usa IA literal e e-mail em arquivo.

```bash
npm run lint
node scripts/codex-cloud.mjs run npm test
npm run build
node scripts/codex-cloud.mjs run npm run test:e2e
```

Os testes SQL, de integração e E2E limpam o banco local de testes. Para iniciar o servidor de produção local após o build: `node scripts/codex-cloud.mjs run npm start`.

- [Execução no Codex Cloud](docs/CODEX-CLOUD.md)
- [Homologação e limitações](docs/HOMOLOGACAO.md)
- [Arquitetura e passagem de bastão](docs/HANDOFF.md)
- [Implantação externa](docs/DEPLOY-CODEX.md)

A main existente é preservada; a importação e validação ficam em `apoia/redesign-fluida` para revisão por Pull Request.
