# GitHub no Codex Cloud: diagnóstico e operação

Verificação realizada em 31/10/2026. O proxy foi mantido e a verificação TLS permaneceu ativa. Nenhuma credencial foi exibida.

## Resultado confirmado

Há duas condições diferentes, reproduzidas com os mesmos comandos e as mesmas variáveis de proxy:

| Teste | Terminal padrão com rede isolada | Executor com rede autorizada |
| --- | --- | --- |
| TCP para `proxy:8080` | `EPERM` (operação não permitida) | Conexão estabelecida |
| `curl -I -sS --max-time 15 https://github.com` | curl 7, sem resposta HTTP | CONNECT 200 e HTTP 200 |
| `curl -I -sS --max-time 15 https://api.github.com` | curl 7, sem resposta HTTP | curl 56, CONNECT 403 |
| `git ls-remote origin HEAD` | Erro de conexão ao proxy | Sucesso |
| `curl -I -sS --max-time 15 https://registry.npmjs.org` | curl 7, sem resposta HTTP | CONNECT 200 e HTTP 200 |
| Consulta do PR pela CLI `gh` | Operação de socket não permitida | `Forbidden` na API |

O curl 7 deste teste decorre do isolamento do executor. Ele não demonstra queda do serviço de proxy: a conexão TCP e dois destinos HTTPS funcionam pelo executor autorizado. O 403 de CONNECT é uma recusa do proxy antes de chegar à API do GitHub; não é evidência de senha incorreta nem de rate limit da API.

## Variáveis e inicialização

- `HTTP_PROXY` e `HTTPS_PROXY`, assim como as versões em minúsculas, estão presentes e coerentes em `http://proxy:8080`, sem autenticação embutida na URL observada.
- `ALL_PROXY` está ausente; não é necessário quando os proxies de HTTP/HTTPS estão configurados.
- `NO_PROXY` e `no_proxy` são coerentes, contêm três entradas e não excluem GitHub, API do GitHub ou registro npm do proxy.
- O endereço herdado coincide com `/etc/codex/network-policy.json`; não há override explícito `http.proxy` para GitHub no Git.
- Não foram encontradas referências de sobrescrita do proxy nos arquivos rastreados do projeto, nas variáveis dos arquivos `.env*` locais, nos scripts de instalação/startup salvos ou nos perfis de shell inspecionados. Foram verificados somente nomes de variáveis e localização de referências.
- Os dois executores usam namespaces de rede diferentes. A variável herdada `CODEX_SANDBOX_NETWORK_DISABLED` sozinha não demonstra a capacidade real de rede; as sondagens TCP e HTTP são a evidência.

## Configuração aplicada e configuração salva

O controle do ambiente informa observações atuais, rede restrita em estado `enforced` e revisão de execução 1. Nessa instância, `github.com` está permitido pelo preset de gerenciadores de pacotes, mas `api.github.com` não consta da política efetiva.

O rascunho vinculado já contém a permissão explícita para `api.github.com`. A publicação informada pelo usuário ainda não se reflete na política observada nesta instância. Não há evidência suficiente para afirmar qual versão foi publicada em outras tarefas ou ambientes.

As ferramentas disponíveis permitem consultar o runtime e salvar o rascunho; não oferecem publicação, reinício ou reconexão da instância. Regravar a mesma permissão não aplica a política ao proxy. O relatório privado de suporte deve incluir os identificadores da instância e da configuração para investigar essa divergência.

## Procedimento para agentes

1. Consultar o estado do ambiente e a política aplicada antes de diagnosticar credenciais.
2. Para Git e HTTP externo, usar o executor de rede autorizado da plataforma, solicitando a permissão suportada pela ferramenta (`sandbox_permissions: "require_escalated"`, quando disponível). Um script de shell não consegue conceder esse acesso a si mesmo.
3. Preservar os proxies e a confiança TLS herdados. Não alterar rotas, contornar o proxy ou ampliar `NO_PROXY` para destinos externos.
4. Executar os três comandos de validação da tabela. Não declarar acesso totalmente resolvido enquanto a API permanecer bloqueada.
5. Encaminhar a divergência entre runtime e configuração ao suporte da plataforma. Solicitar reconciliação da configuração publicada com a instância vinculada, mantendo internet restrita e preservando o filesystem preparado. Não pedir nova publicação repetidamente sem evidência de uma alteração de configuração necessária.

O Git fornecido pela plataforma e a API do GitHub têm escopos distintos. Um `git ls-remote` bem-sucedido não comprova acesso a PRs/checks via API, nem permissão de escrita. Não havia conector GitHub independente disponível nesta sessão para comparar com a CLI. O serviço de controle do ambiente respondeu, mas isso não valida o caminho HTTP do terminal.

## Continuidade sem dependências externas novas

Nesta revisão passaram `npm run typecheck`, `npm run lint`, 27 casos do núcleo e dois casos de proteção de banco/e-mail, além de `npm run build` com dependências já instaladas e telemetria desativada. O preflight local passou em 16/16 verificações de estrutura/presença de configuração; isso não comprova prontidão do staging externo.

Os dois testes de proteção também foram importados e executados no processo Node principal, confirmando seus nomes e asserções, sem depender do isolamento de subprocessos do executor de testes.

Tarefas que podem avançar localmente:

- Ampliar os testes do validador de citações, autorização e transporte de e-mail com fixtures SIMULAÇÃO e sem provedores reais.
- Revisar teclado, responsividade e movimento reduzido das telas, usando serviços locais já preparados quando necessário.
- Revisar textos de privacidade/termos e preparar o aceite de produto; a aprovação jurídica permanece externa.
- Planejar a adaptação de armazenamento e jobs para a hospedagem escolhida, antes de alterar infraestrutura ou executar dados reais.

As suítes SQL, P0 e o seed E2E limpam dados. Elas não foram reexecutadas neste diagnóstico, que não aplicou migrações nem alterou bancos. Não houve merge na main ou publicação de serviços. A aprovação da prévia Vercel foi informada pelo usuário e não foi revalidada remotamente aqui.
