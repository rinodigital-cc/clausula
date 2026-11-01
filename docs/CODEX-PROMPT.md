# Prompt para o Codex

Cole o texto abaixo no Codex com este repositório conectado (branch `apoia/redesign-fluida`).

---

Você vai continuar o projeto ApoIA Seguro, um SaaS para corretoras de seguros feito em Next.js 16 + PostgreSQL 16 (pgvector) com isolamento multiempresa por RLS.

**Antes de qualquer mudança**, leia `docs/HANDOFF.md` inteiro. Ele descreve o que está pronto, a arquitetura, como rodar, como publicar, as regras que não podem ser quebradas e as pendências em ordem.

## Como trabalhar
- Uma pendência por vez, cada uma num branch próprio a partir de `apoia/redesign-fluida` e com um PR separado.
- Antes de abrir o PR: `npm test` (typecheck, unitários, isolamento e integração) e `npm run build` precisam passar. Escreva testes para o que criar.
- Siga os padrões existentes: regras de negócio em `src/lib/domain`, permissões em `src/lib/authz/policy.ts`, banco só via `withTenant` / `withBootstrap` / `withPlatform` / `withPublic`, nunca `DATABASE_URL_ADMIN` em runtime.
- Interface: use somente os tokens e classes de `src/styles/tokens.css` e `src/styles/globals.css` (design system “Fluida”). Não crie cores, sombras ou componentes paralelos. Mantenha WCAG 2.2 AA.
- Não edite migrações já existentes; crie uma nova se precisar.
- Não coloque segredos no repositório. Não invente dados (telefones, CNPJ, clientes, logos de seguradoras, métricas); exemplos sempre marcados como SIMULAÇÃO.
- Não altere textos de negócio nem rotas existentes sem explicar no PR.

## Tarefas, em ordem

1. **Painel da plataforma (`/plataforma`)**. Crie as telas do operador usando as funções de `src/lib/domain/platform.ts`:
   - lista de corretoras com situação e ações (suspender/reativar, reenviar convite do dono);
   - formulário “Nova corretora” (nome, e-mail e nome do dono) que cria a corretora e mostra o link de convite;
   - lista de interessados do site (`listLeads`) com mudança de situação.
   Acesso só para administradores da plataforma (o menu do usuário já mostra o link quando `isPlatformAdmin`). Reaproveite o shell visual da administração (`admin-shell`, `admin-side`, `side-nav`, `table-wrap`, `seg`). Inclua testes de integração para criar corretora pela tela e para bloquear quem não é administrador.

2. **Preparar a publicação.** Siga a seção 6 do HANDOFF. Entregue:
   - `Dockerfile` da aplicação (build standalone do Next) e `Dockerfile.worker` (ou um único Dockerfile com dois comandos);
   - configuração para a hospedagem escolhida (pergunte qual antes; a recomendação é uma que tenha volume persistente e processo contínuo, como Railway, Render ou Fly.io, com Postgres gerenciado que tenha pgvector);
   - um `docs/DEPLOY.md` com o passo a passo: criar banco, rodar `db:migrate` e `db:roles`, variáveis, primeiro administrador (`npm run plataforma:admin`), domínio e HTTPS, verificação pós-deploy.
   **Não publique, não altere DNS e não contrate nada sem aprovação explícita.**

3. **E-mail real.** Confirme que `services/worker/email.ts` envia via Resend quando `EMAIL_TRANSPORT` e `RESEND_API_KEY` estão definidos, e documente a verificação do domínio. Sem chave, o comportamento atual (não enviar) deve continuar.

4. **Testes de ponta a ponta** em `tests/e2e` com Playwright: login, envio de PDF pela administração, consulta com fonte, consulta sem resposta e isolamento entre duas corretoras.

Ao terminar cada tarefa, resuma no PR o que mudou, como testar e qualquer conflito com o HANDOFF.

## Interface (só se for pedido ajuste visual)
A linguagem visual “Fluida” já está implementada. Para qualquer tela nova: camadas brancas sobre o fundo com aura, sombra em vez de borda, manchetes grandes (peso 700, letter-spacing −0.035em), pílulas para navegação e filtros. Cor com função: azul = marca, ações e o que a IA escreveu; verde = o que está no documento; âmbar = ressalva. Respeite `prefers-reduced-motion`.
