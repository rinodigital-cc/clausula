# Execução no Codex Cloud

Use `/workspace/clausula`, branch `apoia/redesign-fluida`. Cada tarefa já possui ambiente isolado: use o checkout existente, sem criar worktree.

## Instalar e preparar

Requisitos: Node 22+, npm, Docker local funcional e Chromium. O ambiente desta sessão possui Node 24, Docker e `/usr/bin/chromium`. O Dockerfile e o CI usam Node 22.

```bash
cd /workspace/clausula
npm ci --no-audit --no-fund --strict-ssl=true
npm run cloud:setup
```

O script é repetível. Usa `pgvector/pgvector:pg16` fixado por digest, container `apoia-codex-db`, volume `apoia-codex-db`, porta `127.0.0.1:55432` e banco `apoia_codex_test`. As 14 migrações têm checksum; nenhuma migração herdada foi alterada. As credenciais locais são geradas aleatoriamente em `.env.codex.local`, com permissão 0600 e ignoradas pelo Git. Não leia ou imprima esse arquivo para diagnosticar setup.

O helper usa o daemon local em `/var/run/docker.sock`, preserva o proxy e a confiança TLS e desativa as chaves de provedores externos em seus subprocessos. Se o daemon não estiver disponível, solicite recuperação do ambiente; não instale outro daemon ou VPN.

## Iniciar web e worker

Execute em dois terminais/sessões de processo, no diretório acima:

```bash
node scripts/codex-cloud.mjs run npm run dev
node scripts/codex-cloud.mjs run npm run worker
```

Validação interna, sem criar link de preview:

```bash
node -e 'fetch("http://localhost:3000/api/saude").then(async r => { console.log(await r.json()); if (!r.ok) process.exitCode = 1; })'
```

O retorno esperado é HTTP 200, `ok: true`, `db: "ok"`. Um processo vivo ou uma porta aberta não substitui essa verificação. O worker processa PDFs e grava e-mails simulados em arquivo. Para esvaziar a fila e sair:

```bash
node scripts/codex-cloud.mjs run npm run worker -- --once
```

Para produção local, pare apenas os processos que você iniciou e use:

```bash
npm run build
node scripts/codex-cloud.mjs run npm start
```

O build prepara os assets do servidor standalone. A inicialização normaliza `STORAGE_DIR` antes de o Next mudar seu diretório de trabalho; web e worker compartilham os PDFs.

## Validar

Com a porta 3000 livre:

```bash
npm run lint
node scripts/codex-cloud.mjs run npm test
npm run build
node scripts/codex-cloud.mjs run npm run test:e2e
```

`npm test`: TypeScript, 29 casos unitários, 47 casos SQL de isolamento e 68 casos de integração. O E2E inicia e encerra sua própria web standalone, prepara fixtures SIMULAÇÃO e roda dez cenários no Chromium, incluindo axe WCAG 2.2 AA em sete telas.

As suítes SQL, P0 e E2E limpam os dados do banco local. Exigem `ALLOW_TEST_DB_RESET=1`, host local, nome terminado em `_test` e URLs de runtime para o mesmo banco. Não execute enquanto outra pessoa estiver usando os dados de demonstração. Os relatórios em `test-results/`, os PDFs recebidos em `storage/`, dependências e arquivos `.env*` reais são ignorados.

Se Chromium não estiver instalado, use `npx playwright install --with-deps chromium` em um host que suporte essa instalação; ou indique o executável com `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. O CI instala o navegador explicitamente.

## Docker de homologação

No Codex, monte a CA do proxy apenas durante o build:

```bash
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" --target web -t apoia-seguro:web .
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" --target worker -t apoia-seguro:worker .
```

O certificado não entra nas camadas. Não desative TLS ou altere integridades do lockfile para contornar falhas. Fora do proxy gerenciado, o segredo de build é opcional.

## Snapshot e rascunho

Dependências, checkout e arquivos preparados podem ser retidos na publicação do ambiente; processos precisam ser iniciados novamente. As instruções `install_script` e `start_skill` ficam no rascunho das configurações. Salvar um rascunho não o aplica nem publica: revise, salve e publique pela interface do ambiente.

O Git autenticado usa o proxy fornecido pela plataforma. Criar PR pela CLI também requer acesso a `api.github.com`; não solicite um token pessoal só porque a API estiver bloqueada pela política de rede.
