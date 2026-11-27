# QA — Vera.ia

## Resultado local (27/11/2026, reexecutado após rebase sobre `8149bd9`; PostgreSQL 16 + pgvector descartável, recriado do zero)

| Suíte | Resultado |
|---|---|
| Lint (`--max-warnings=0`) | OK |
| TypeScript | OK |
| Unitários núcleo | 27/27 |
| Unitários e-mail, entrega, webhook, estados, templates, storage, redirect | 12/12 |
| Unitários Supabase Auth | 7/7 |
| Isolamento SQL entre corretoras | 47/47 |
| Integração de domínio | 78/78 (eram 68; +10 de e-mail, limites e privilégios) |
| Build de produção | OK |
| Smoke HTTP no build local | `/` 200 · `/entrar` 200 · `/privacidade` 200 · `/admin` 307→`/entrar` · `/plataforma` 307→`/entrar` · `/api/saude` 200 `ok/db ok` · callback inválido 302→`/recuperar?invalido=1` · rota insegura antiga 404 · webhook sem assinatura 401 |
| E2E Playwright | **Não executado localmente** (navegador indisponível neste ambiente). Roda no GitHub Actions após o push. |

Casos novos de integração: E02 duplicidade recusada · E03 reenvio imediato bloqueado · E04 reenvio ligado ao novo convite, um único convite válido · E05 link anterior invalidado · E06 painel nunca mostra "entregue" sem provedor · E07 histórico · E08 operador não lê corpo/link · E09 aviso de senha alterada · E10 boas-vindas · E11 tabela de limites inacessível.

## Desempenho (27/11/2026, banco local com volume SIMULADO: 400 corretoras, 20 mil e-mails)

| Operação | Mediana | Pior de 5 |
|---|---|---|
| Painel: lista de corretoras com estado do convite | 21,3 ms | 24,3 ms |
| Detalhe de uma corretora | 1,1 ms | 1,3 ms |
| Histórico de envios da corretora | 0,3 ms | 0,5 ms |
| Despacho: varredura da fila + teto diário | 8,6 ms | 9,2 ms |
| `/api/saude` (build de produção) | 1 ms | — |

Medidas de desempenho aplicadas: índices para teto diário e status pendente de entrega; detalhe busca só a corretora pedida (antes carregava a lista inteira); lista limitada a 500; consulta de status em lotes paralelos de 4 (antes 600 ms por mensagem, até 6 s presos na tela); envio imediato com tempo-limite de 8 s (sem perder a mensagem: volta para a fila com a mesma chave de idempotência).

Latência de rede real (Vercel ↔ Supabase ↔ Resend) só pode ser medida na homologação.

## Roteiro em homologação (evidência real exigida)

| # | Cenário | Evidência |
|---|---|---|
| 01 | Cadastrar corretora de teste | tela "Convite enviado", linha no painel |
| 02 | Recebimento | e-mail na caixa de teste + id do Resend + status **Entregue** |
| 03 | Primeiro acesso | criar senha, entrar, painel mostra **Conta ativa** |
| 04 | Recuperação | pedir, receber, redefinir, entrar; aviso "senha alterada" recebido |
| 05 | Reenvio | botão no painel, novo e-mail recebido, link antigo recusado |
| 06 | Expirado | convite vencido mostra estado e permite novo envio |
| 07 | Permissões | usuário comum em `/plataforma` → `/sem-permissao` |
| 08 | Multiempresa | corretora B recebe 404 no PDF da A |
| 09 | Responsividade | 1440 px e 390 px |
| 10 | Consulta | pergunta com fonte (documento, página, trecho) e pergunta sem evidência |
| 11 | Infraestrutura | `/`, `/entrar`, `/privacidade`, `/admin`, `/api/saude` |

Não declarar recebimento sem o e-mail na caixa postal.
