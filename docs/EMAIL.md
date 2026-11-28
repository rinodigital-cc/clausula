# E-mail transacional — Vera.ia

## Arquitetura escolhida (um único caminho)

```
ação do usuário ──► transação no Postgres ──► email_outbox (pending)
                                   │ commit
                                   ▼
                     deliverNow(id)  ──►  API do Resend  ──► status = sent / delivery = accepted
                                   │ falhou?                        │
                                   ▼                                ▼
                     fila Vercel / worker (retry)     webhook assinado ou consulta → delivered / bounced …
```

Avaliadas as duas opções pedidas:

| Opção | Decisão |
|---|---|
| A. Supabase Auth com SMTP do Resend | **Não usada como caminho principal.** Os convites da plataforma não são do Supabase (tabela `invitations`), então haveria dois sistemas de envio, dois templates e nenhum status de entrega por mensagem. Fica apenas como *fallback* da recuperação quando `SUPABASE_AUTH_SECRET_KEY` não existe. |
| B. Supabase gera o link no servidor; envio pela API do Resend | **Escolhida.** Um só remetente, um só template, idempotência por mensagem (`Idempotency-Key`), histórico e status no painel. |

### Causa raiz da falha anterior

1. Na Vercel não havia `RESEND_API_KEY` nem `EMAIL_FROM` verificado: o despacho mantinha tudo como `pending` para sempre (correto: nada era declarado enviado, mas nada saía).
2. O despacho só acontecia quando a fila acordava o processador (`PROCESSING_DRIVER=vercel`). Agora o envio é **imediato após o commit**; a fila virou rede de segurança.
3. A recuperação no modo Supabase usava `resetPasswordForEmail`, que depende do SMTP interno do Supabase (limite baixo e entrega só para membros do projeto). Agora o link é gerado com `auth.admin.generateLink` e enviado pelo mesmo caminho.

## Estados

| Campo | Valores | Significado |
|---|---|---|
| `status` (despacho) | `pending` · `sent` · `failed` · `skipped` | `sent` = **aceito** pelo Resend. `skipped` só em desenvolvimento (arquivo). |
| `delivery_status` | `accepted` · `delivered` · `delivery_delayed` · `bounced` · `complained` · `failed` · `suppressed` | Só `delivered` significa entregue. Estado nunca regride. |

Painel (estado do responsável): Aguardando envio → Enviado · aguardando ativação → Entregue · aguardando ativação → Conta ativa. Também: Convite expirado, Falha no envio, Não enviado · sem provedor.

## Limites (protegem a franquia gratuita)

| Limite | Valor | Onde |
|---|---|---|
| Teto diário da plataforma | 90 (`EMAIL_DAILY_CAP`) | despacho adia 1 h quando atinge |
| Reenvio de convite por corretora | 1 a cada 2 min e 5 por dia | `reissueOwnerInvite` + `consume_email_limit` |
| Recuperação de senha por e-mail | 3 por hora (silencioso) | `requestPasswordReset` |
| Convites de membros por corretora | 20 por hora | `inviteMember` (já existia) |
| Novas tentativas | até 5, espera 1→2→4→8 min; 4xx de configuração falha na hora | `dispatchEmails` |

Resend gratuito: 100 e-mails/dia e 3.000/mês; ao atingir, o envio pausa (não cobra).

## Templates

`src/lib/email/outbox.ts` — HTML em tabelas (Gmail/Outlook), sem JavaScript, sem imagens externas, versão em texto simples, contraste AA (botão vinho `#401C28` com texto branco 14,8:1; links `#B3401F` 5,7:1).

1. Convite de corretora · 2. Convite de usuário · 3/4. Primeiro acesso / criação de senha · 5. Recuperação · 6. Confirmação de e-mail · 7. Reenvio de convite · 8. Boas-vindas · 9. Senha alterada.

Nenhum template contém senha. Links de convite expiram em 7 dias; de recuperação, em 1 hora.

## Configuração do Resend (homologação)

1. Conta gratuita no Resend (login com Google, feito pelo responsável).
2. Domínio de envio **`mail.apoiaseguro.com.br`** (subdomínio dedicado: isola a reputação dos e-mails transacionais do Google Workspace do domínio raiz).
3. No Registro.br, adicionar **somente** os registros que o Resend mostrar (normalmente `resend._domainkey.mail` TXT/DKIM, `send.mail` MX e `send.mail` TXT/SPF). **Não alterar** o MX `smtp.google.com` nem o TXT de verificação do Google na raiz.
4. DMARC (raiz, monitoramento): `_dmarc.apoiaseguro.com.br TXT "v=DMARC1; p=none"`.
5. Em Domains → Configuration: **Click tracking e Open tracking desligados** (reescrita de link quebra links de autenticação).
6. Chave: integração oficial Resend na Vercel (Marketplace) vinculada ao projeto `apoio-seguro`, ambiente **Preview** apenas, permissão de envio. A chave nunca passa por chat, Git ou log.
7. Vercel Preview: `EMAIL_FROM="Vera.ia <acesso@mail.apoiaseguro.com.br>"`, `EMAIL_TRANSPORT` ausente ou `resend`.
8. Opcional: webhook `https://<homolog>/api/webhooks/resend` (eventos `email.*`) e `RESEND_WEBHOOK_SECRET` na Vercel. Sem webhook, o botão **Atualizar envios** consulta o status no Resend.

Verificação: `GET /api/saude` → `"email":"provedor"`.
