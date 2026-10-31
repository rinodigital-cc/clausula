# Homologação do ApoIA Seguro

Validação local realizada em 31/10/2026, usando exclusivamente PostgreSQL descartável e dados SIMULAÇÃO. Não houve conexão ao Supabase, envio real de e-mail, chamada a IA paga, alteração de DNS ou publicação externa.

## Estrutura importada

- `src/app`: site, autenticação, consultas, biblioteca, administração, painel da plataforma e rotas HTTP.
- `src/lib`: autenticação, autorização, acesso a banco por papel, domínio, armazenamento e auditoria.
- `services/ai`: recuperação, modo literal e validador de citações; provedor Anthropic opcional.
- `services/worker`: extração/indexação de PDF e caixa de saída de e-mails.
- `db`: 14 migrações, aplicador com checksum e preparação dos cinco logins de runtime.
- `tests`: núcleo, proteções de execução, isolamento SQL, integração P0 e E2E.
- `public`: marca, ícones, fontes auto-hospedadas e licença.

O remoto inicialmente continha apenas README na main (`57636ea`). A branch de revisão é `apoia/redesign-fluida`; não há reescrita da main. Os documentos do ZIP foram tratados como referências, e as alegações de validação anterior foram conferidas por novas execuções.

## Resultados

| Verificação | Resultado |
| --- | --- |
| Instalação pelo lockfile | `npm ci` concluído com TLS e integridades preservados |
| TypeScript estrito | Passou, incluindo a antiga suíte que usava `@ts-nocheck` |
| ESLint | Passou sem avisos |
| Unitários | 27 do núcleo + 2 de proteção do banco/transporte de e-mail |
| Isolamento PostgreSQL/RLS | 47/47 |
| Integração P0 | 68/68 |
| Build Next standalone | Passou |
| Chromium E2E | 10/10, sem testes ignorados |
| Axe | Sem violações nos critérios WCAG A/AA selecionados em sete telas; não substitui avaliação manual |
| Migrações e roles | 14 migrações; segunda execução sem reaplicar migrações |

Os cenários E2E cobrem saúde e site, login incorreto/correto, pergunta com fonte e PDF autorizado, pergunta sem evidência, isolamento entre corretoras, bloqueio da plataforma para usuário comum, criação/convite/suspensão/reativação de corretora, qualificação de contato e upload processado pelo worker.

## Correções e entregas

- Painel `/plataforma`, `/plataforma/nova` e `/plataforma/interessados`, usando domínio, guardas e estilos existentes.
- Correções nos efeitos React e na seleção da afirmação ativa, sem desativar regras de lint ou remover a camada de evidência.
- Trava dos testes destrutivos para banco local descartável; executor SQL preserva erros do processo e exige o total esperado de casos.
- `EMAIL_TRANSPORT=file` prevalece mesmo se houver uma chave no ambiente; teste comprova ausência de chamada HTTP e que a mensagem não é marcada como enviada.
- Inicialização standalone com assets e caminho absoluto compartilhado de armazenamento. O teste de PDF detectou e confirmou a correção da diferença de diretório entre web e worker.
- Setup local repetível, workflow de CI e instruções de Codex Cloud.
- `.gitignore` cobre variantes de `.env`, dependências, builds, resultados e arquivos de chave. `.env.example` é somente um modelo, sem credenciais reais; contas dos testes são SIMULAÇÃO.

## Pendências externas

1. Escolher/provisionar staging: web e worker contínuos, Postgres com pgvector e disco persistente compartilhado. Nenhum provedor foi escolhido ou contratado.
2. Configurar secrets de staging pelo provedor, cinco URLs de runtime com privilégios mínimos e URL HTTPS. Nunca distribuir a URL de administrador para a web/worker.
3. Comparar qualquer schema legado antes de uma migração. O relato sobre Supabase nos documentos recebidos não comprova o estado atual; não houve inspeção nem alteração desse projeto.
4. Provedor de e-mail, domínio verificado e validação real de entrega/recuperação de senha. Os testes locais não enviam mensagens reais.
5. Chave Anthropic, modelo autorizado e revisão das respostas no modo redigido pela IA. Até aqui, a funcionalidade foi validada no modo literal.
6. Aceite manual e de acessibilidade no staging; revisão jurídica de privacidade e termos; símbolo definitivo da marca.
7. Revisar e integrar o PR; publicar a configuração do Codex Cloud pela interface. A criação automática do PR depende da liberação de `api.github.com` na rede do ambiente.
