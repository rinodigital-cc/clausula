# Relatório de QA — Milestone 1

**70 casos executados** contra PostgreSQL 16.14 real.
Isolamento SQL 17/17 · Integração 21/21 · Adversarial 32/32 · `tsc` 0 erros.

## Cobertura: o que NÃO pôde ser testado

Você pediu testes para 14 áreas. **Nove não existem no código.**

| Área | Situação |
|---|---|
| authentication | Parcial — tabela de sessão e resolução existem; fluxos de login não |
| authorization / permissions | ✅ testado |
| tenant isolation | ✅ testado |
| specialist creation · document upload · processing · RAG · citations · chat · history · billing · API | ❌ **não implementado** |

Cenários adversos 2, 3, 4 (parcial), 5, 6, 7, 8, 11, 12 e 13 dependem dessas
áreas e ficam sem cobertura. Registrar isso é o resultado mais honesto do
relatório: um plano de testes que "passa" em módulo inexistente é pior que
nenhum teste.

---

## BUG-01 — Contexto de tenant forjado vaza dados de outra corretora

**SEVERIDADE: CRÍTICA** (R-11 / R-01 do threat model)

**COMO REPRODUZIR**
```ts
const forjado = { orgId: orgDaConcorrente, userId: meuId };
await withTenant(forjado, (tx) => tx`SELECT name FROM organizations`);
// → retornava a linha da outra corretora
```

**CAUSA** — `TenantContext` era objeto literal. A RLS confia em
`app.current_org`, e quem define esse valor é a aplicação. A única proteção era
a convenção "sempre derive de `resolveActor`". Toda defesa que depende de
disciplina falha no dia de pressa.

**CORREÇÃO** — `Session` verificada, produzida só por `resolveSession`, que lê
o vínculo real no banco. `withTenant` rejeita qualquer outra coisa.

### BUG-01b — a primeira correção era insuficiente

**COMO REPRODUZIR**
```ts
await withTenant({ ...sessaoLegitima, orgId: outraOrg }, ...);  // vazava
```

**CAUSA** — a marca era propriedade de `Symbol` no objeto. Spread copia
propriedades de Symbol próprias e enumeráveis: a marca sobrevivia.
**Marca-por-propriedade é sempre copiável.**

**CORREÇÃO** — registro de **identidade** em `WeakSet`. Só as referências
devolvidas por `resolveSession` entram. Spread, `Object.assign`, clone e
`JSON.parse` produzem objetos novos, que não estão no registro.

---

## BUG-02 — Ator forjado aceito pela autorização

**SEVERIDADE: CRÍTICA**

**REPRODUZIR** — `listMembers(ctx, { userId, orgId, role: "owner", status: "active" })`
**CAUSA** — `Actor` era objeto literal; qualquer código construía `role: "owner"`.
**CORREÇÃO** — `Actor` passou a ser a `Session` verificada. `can()` retorna
`false` para o que não estiver no registro.

**Ganho colateral:** org, usuário e papel agora viajam juntos. Antes era
possível parear ator da org A com contexto da org B — e o caso A9b.5 só passava
por sorte, bloqueado por uma checagem que existia para outro motivo.

---

## BUG-03 — Papel não validado em runtime

**SEVERIDADE: MÉDIA**

**REPRODUZIR** — `changeMemberRole(session, { userId, role: "owner" })` com o
valor vindo de corpo de requisição.
**CAUSA** — `Exclude<Role,"owner">` é anotação; some na compilação. O único
bloqueio era a CHECK do banco — que barrava, mas com erro de constraint no
lugar de erro de domínio.
**CORREÇÃO** — `assertAssignableRole()` valida com dado, e distingue "papel
inválido" de "owner não pode ser atribuído aqui".

---

## BUG-04 — Sem rate limiting

**SEVERIDADE: ALTA** (R-08)

**REPRODUZIR** — 40 convites simultâneos: 40 aceitos.
**CAUSA** — nenhum limite em lugar nenhum.
**CORREÇÃO** — `consume_rate_limit()` no Postgres, janela deslizante,
atômica por `INSERT ... ON CONFLICT`. Convites: 20/hora por organização.
Após o fix: 17 de 40 passam.

---

## BUG-05 — Corrida na geração de slug

**SEVERIDADE: MÉDIA**

**REPRODUZIR** — três `createOrganization` simultâneos com o mesmo nome: um falhava.
**CAUSA** — janela entre o `SELECT` de disponibilidade e o `INSERT`.
**CORREÇÃO** — captura de violação de unicidade (23505) com nova tentativa e
sufixo aleatório.

---

## BUG-06 — `new Error(undefined)`

**SEVERIDADE: BAIXA** — `verdict.reason` é opcional; mensagem vazia na interface.
**CORREÇÃO** — texto padrão.

---

## Aceito e não corrigido

**Sessão em memória não revalida.** Uma `Session` resolvida antes da remoção do
membro continua funcionando até o fim da requisição. Corrigir exigiria uma ida
ao banco por operação. Aceito com TTL curto de requisição — e registrado aqui
para não virar surpresa.

---

## Recomendações

1. As três suítes vão para a CI. Qualquer FAIL bloqueia merge.
2. **Nenhuma tabela nova sem caso no teste de isolamento** — T17 já checa a
   invariante, mas cobertura de caminho é manual.
3. Rate limit em todo endpoint que gere e-mail ou custo de IA, não só convites.
4. Testes de RAG, upload e citações precisam existir **junto** com o código —
   não depois. As milestones 2 e 3 concentram os cenários adversos mais caros
   (documento malformado, injeção via documento, conflito, falha de provedor).
