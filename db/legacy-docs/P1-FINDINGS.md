# P1 confirmado — e a mitigação documentada não funciona

**Experimento executado** · PostgreSQL 16.14 · pgvector **0.8.0** compilado do
fonte · 250.000 chunks · 50 organizações · vetores de 384 dimensões.

---

## O que foi testado

Distribuição deliberadamente desigual, como o mercado real:

| Tenant | Chunks | % do corpus |
|---|---|---|
| Corretora grande | 150.000 | 60% |
| 9 corretoras médias | 10.000 cada | 36% |
| 40 corretoras pequenas | 250 cada | 4% |

Consulta: **top-10 filtrado por organização**, usando como vetor de busca uma
cópia exata de um vetor que pertence à própria organização. O vizinho mais
próximo existe, tem distância zero e é dela.

---

## Resultado

```
A) padrão (ef_search=40, iterative off)      → 0 linhas   ❌
B) ef_search=1000                            → 10 linhas  ⚠  (o planner
                                                              desistiu do HNSW)
C) iterative_scan=relaxed, max_scan=100k     → 0 linhas   ❌
D) iterative_scan=strict,  max_scan=100k     → 0 linhas   ❌
E) relaxed + scan_mem_multiplier=8           → 0 linhas   ❌
F) relaxed + scan_mem_multiplier=32          → 0 linhas   ❌
G) índice HNSW PARCIAL para a organização    → 10 linhas  ✅
```

Plano da falha:

```
Index Scan using chunks_test_hnsw  (actual rows=0)
  Order By: (embedding <=> $0)
  Filter: (org_id = 5)
  Rows Removed by Filter: 470
```

O grafo global foi percorrido, 470 candidatos vieram, **todos pertenciam a
outras corretoras**, o filtro matou todos e a consulta devolveu vazio.

---

## Duas conclusões, e a segunda corrige o meu próprio documento

### 1 · P1 é pior do que eu documentei

Eu escrevi que a organização pequena "pode receber menos resultados que o
top-k, ou nenhum". Na prática:

> **A corretora faz uma pergunta cuja resposta está literalmente no documento
> dela, e a recuperação devolve nada.**

Em produto, isso vira "não encontrei no acervo" — uma recusa educada e
plausível — para uma pergunta que tem resposta. Não gera erro, não gera alerta,
não aparece em log. É a pior forma de falha possível: silenciosa, e indistinguível
de comportamento correto.

E o gatilho não é o cliente pequeno ficar pequeno. É **outro cliente ficar
grande**. Uma corretora que funcionava perfeitamente passa a falhar porque uma
corretora vizinha subiu muitos documentos. Nada mudou na conta dela.

### 2 · A mitigação nº 1 que eu recomendei **não funciona**

No modelo de dados eu listei `hnsw.iterative_scan` como "a resposta certa hoje".
**Está errado.** Testei as duas variantes, com `max_scan_tuples` até 100.000 e
`scan_mem_multiplier` até 32: o scan para em 470 tuplas e devolve zero linhas em
todos os casos.

Não é ajuste de parâmetro. É limitação estrutural de percorrer um grafo global
com filtro de alta seletividade.

O caso B merece atenção: `ef_search=1000` "funcionou", mas não porque o HNSW
melhorou — porque o custo estimado subiu e **o planner abandonou o índice
vetorial**, caindo em varredura exata pelo índice de `org_id`. Foi acerto por
desistência, não por qualidade. Depender disso é depender de estimativa de custo,
que muda com o volume dos vizinhos.

---

## Correção arquitetural proposta

O que funciona é **isolamento físico do grafo**: cada organização com índice HNSW
próprio. Confirmado no teste G — 10 de 10 linhas.

Roteamento por tamanho de tenant, decidido na camada de consulta:

| Tamanho do acervo | Estratégia | Verificado |
|---|---|---|
| < ~50.000 chunks | Filtro por `org_id` + ordenação exata. Mais rápido **e** exato | ✅ caso das corretoras pequenas |
| ≥ ~50.000 chunks | Índice HNSW **parcial**, criado no onboarding da organização | ✅ caso G |

**Implicações que precisam entrar no plano:**

- Criar organização passa a executar DDL (`CREATE INDEX ... WHERE org_id = X`)
  quando o acervo cruza o limiar. Isso vira job, não caminho síncrono
- Centenas de índices parciais são viáveis; milhares não. Ao chegar lá, a
  saída é particionar `chunk_embeddings` por `org_id` com índice local por
  partição — mesmo efeito de isolamento, com custo administrativo constante
- O limiar de 50.000 é o ponto de virada observado neste hardware. **Precisa ser
  medido no ambiente real**, não copiado daqui

---

## Achado secundário

Durante a construção do índice, com 512 MB de `maintenance_work_mem`:

```
NOTICE: hnsw graph no longer fits into maintenance_work_mem after 240154 tuples
DETAIL: Building will take significantly more time.
```

240 mil vetores de 384 dimensões já estouram 512 MB. Com 1024 dimensões — a
escolha do modelo de dados — o mesmo limite chega em torno de 90 mil vetores.
Isso **confirma o problema P4**: o dimensionamento da instância é ditado pelo
índice, não pelo número de usuários. Uma instância subdimensionada com poucos
clientes é mais lenta que uma bem dimensionada com muitos.

---

## Por que isto importa mais que o código que ele corrige

Esta falha estava documentada como risco desde o modelo de dados, com uma
mitigação que eu apresentei com confiança e que **não funciona**. Seis
documentos de arquitetura não pegaram. Quarenta e quatro segundos de carga e um
`EXPLAIN ANALYZE` pegaram.

Ela teria aparecido em produção como aumento gradual da taxa de "não encontrei"
— exatamente a métrica que o PRD diz para vigiar, e que teria sido interpretada
como acervo incompleto, não como bug de recuperação. O diagnóstico errado leva a
pedir mais documentos ao cliente, que não resolve nada.

**Antes de qualquer código de RAG, a milestone 3 precisa começar por este
roteamento.** Construir o pipeline em cima do comportamento padrão significa
construir sobre uma falha silenciosa.
