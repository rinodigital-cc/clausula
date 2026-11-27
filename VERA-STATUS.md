# VERA-STATUS — acompanhamento da entrega

Atualizado: 26/11/2026. Branch: `vera/email-convites-homologacao` (sobre `apoia/redesign-fluida@afd61cb`).
Regras mantidas: custo R$ 0, produção intocada, sem merge na `main`, sem credenciais em chat/Git/log.

## 1. Auditoria (fatos verificados)

| Item | Achado | Evidência |
|---|---|---|
| Repositório | `main` só tem README; o app está em `apoia/redesign-fluida` (PR #1 aberto, 60 commits). | `git branch -a`, página do PR |
| Stack | Next.js 16 + React 19, Postgres/pgvector com 5 papéis e RLS, Supabase Auth opcional (homologação), Vercel Queue, Resend via API. 18 migrações. | `package.json`, `db/migrations` |
| Correções de 08/11 | **Nunca chegaram ao GitHub** (push bloqueado naquela sessão). Reaplicadas aqui. | ausência de `src/lib/http` e presença da rota insegura no remoto |
| Rota insegura | `GET /api/internal/send-admin-recovery` pública disparava recuperação para e-mail fixo. **Removida.** | commit `fix(security)` |
| Causa raiz dos convites | (1) sem `RESEND_API_KEY`/`EMAIL_FROM` na Vercel o despacho mantém tudo pendente; (2) despacho só ocorria quando a fila acordava; (3) recuperação dependia do SMTP interno do Supabase. | `services/worker/email.ts`, `src/lib/domain/account.ts` |
| DNS | NS Registro.br (`e/f.sec.dns.br`); MX `smtp.google.com` (preservar); TXT google-site-verification; **sem SPF, sem DMARC**; `homolog.apoiaseguro.com.br` **não existe** (NXDOMAIN). | consultas DNS públicas |
| Build | Next 16.4.3 bloqueava o build por vulnerabilidade conhecida → 16.4.6. | saída do `next build` |
| Linha de base | lint OK; 27+5+7 unitários; 47 isolamento; 68 integração. | execução local |

## 2. Decisões técnicas

- **Envio único:** caixa de saída → API do Resend, despacho imediato após o commit; fila como reserva. Recuperação gerada com `generateLink` e enviada pelo mesmo caminho (detalhes em `docs/EMAIL.md`).
- **Aceito ≠ entregue:** `status=sent` é aceite do provedor; entrega só com evento `delivered` (webhook assinado ou consulta).
- **Subdomínio de envio:** `mail.apoiaseguro.com.br`, remetente `Vera.ia <acesso@mail.apoiaseguro.com.br>`, para isolar a reputação do Google Workspace da raiz.
- **Falha parcial:** falha de envio nunca desfaz o cadastro; e-mail fica pendente com nova tentativa e o painel mostra o estado real.
- **Marca:** Vera.ia nas telas, títulos, e-mails e callbacks. Mantidos: nome do pacote, tabelas, papéis de banco, caminhos `public/brand/*` e o texto de consentimento LGPD dos leads (a ApoIA Seguro segue como entidade institucional/controladora).

## 3. Entregue no código

Migração 0018 (aditiva) · 9 templates + texto simples · webhook Resend assinado e idempotente · status de entrega no painel e página de histórico por corretora · reenvio com intervalo e teto diário · teto diário global (90) · recuperação e aviso de senha alterada · boas-vindas · página "Corretora criada" no design system · redirecionamentos relativos · diagnóstico em `/api/saude` · aviso de gateway não transacional · modelo de IA conforme transporte · documentação (`docs/AUTH.md`, `EMAIL.md`, `DEPLOY.md`, `QA.md`, `SECURITY.md`, `.env.example`).

## 4. Bloqueios (dependem de autorização/login pessoal)

| Bloqueio | Situação | Ação necessária |
|---|---|---|
| Push no GitHub | Permissão de envio negada pelo controle de segurança da sessão | Marcelo autorizar explicitamente o push na branch nova |
| Vercel | Navegador do app sem login | Login em vercel.com |
| Resend | Sem conta | Criar conta gratuita (login Google) |
| Registro.br (DNS) | Sem login | Login para SPF/DKIM/DMARC e CNAME `homolog` |
| Supabase | Painel não carregou sem sessão | Login (para migração 0018 e redirect do Auth) |
| Caixa de teste | Nenhuma definida | Uma caixa legível no navegador do app |
| E2E local | Instalação de navegador bloqueada neste ambiente | Roda no GitHub Actions após o push |

## 5. Status por critério (Definition of Done)

| Critério | Status |
|---|---|
| Domínio validado para envio | Bloqueado por dependência externa |
| Resend operacional | Bloqueado por dependência externa |
| Cadastro de corretora | Implementado, aguardando validação (testado localmente) |
| Convite automático | Implementado, aguardando validação (testado localmente sem provedor) |
| E-mail recebido | Bloqueado por dependência externa |
| Criar senha | Implementado, aguardando validação (testado localmente) |
| Entrar na plataforma | Implementado, aguardando validação (testado localmente) |
| Recuperação de senha | Implementado, aguardando validação |
| Reenvio pelo administrativo | Implementado, aguardando validação (testado localmente) |
| Permissões preservadas | Confirmado e testado (47 SQL + 78 integração, local) |
| Identidade visual aplicada | Parcialmente funcional (tokens e e-mails; revisão visual pendente) |
| Deploy de homologação acessível | Bloqueado por dependência externa (DNS inexistente, push pendente) |
| Testes com evidências reais | Parcialmente funcional (local real; homologação pendente) |
| Dados existentes preservados | Confirmado (nenhuma escrita remota) |
| Produção não alterada | Confirmado |
| Custo adicional R$ 0 | Confirmado |

**Conclusão: 4 de 16 critérios confirmados e testados (25%).** A entrega NÃO está concluída.

## 6. Custos e limites dos planos gratuitos

| Serviço | Limite relevante | Impacto |
|---|---|---|
| Vercel Hobby | Uso restrito a não comercial | Testes/protótipo ok; **uso comercial com corretoras pagantes exige Pro**. Confirmar o plano da equipe RINODESIGN. |
| Supabase Free | 500 MB por projeto, pausa após 7 dias sem atividade, sem backup automático | Homologação ok; produção exige plano pago ou backup próprio |
| Resend Free | 100/dia, 3.000/mês; pausa ao atingir (sem cobrança) | Teto interno 90/dia e limites de reenvio |
| GitHub Actions | Cota gratuita do plano | CI atual cabe |
| IA (Anthropic/AI Gateway) | Pago por uso | Sem chave = modo literal (R$ 0); `DAILY_BUDGET_BRL` limita gasto |
