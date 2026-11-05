# Processamento serverless — 05/11/2026

Código adaptado para Vercel Queues, sem contratar host externo. Backend do banco e arquivos não está conectado: não considerar MVP operacional.

## Implementação

- @vercel/queue 0.11.0 fixado no lockfile; consumidor POST /api/queues/processar registrado em vercel.json.
- PROCESSING_DRIVER=vercel habilita notificações após upload, reprocessamento e convites administrativos. Padrão standalone preserva o worker existente.
- SDK valida entregas; um trabalho por invocação, maxDuration 300s. Retry de 650s respeita lease PostgreSQL de 10 minutos após interrupções; máximo de cinco entregas. Jobs persistidos no banco permitem reprocessamento administrativo.
- Botão protegido na plataforma permite retomar processamento após falha de notificação. Não há varredura periódica automática; se o envio à fila falhar, precisa retomar pelo painel. Não confundir persistência do job com garantia de publicação atômica na fila.
- E-mails na Vercel permanecem pendentes sem provedor configurado. Idempotency-Key por mensagem reduz duplicações ao tentar novamente. Recuperação de senha ainda requer acionamento de despacho; homologar fluxo antes de liberar.
- Upload via Server Action limitado a 3 MB na Vercel (validação cliente e servidor). Docker mantém 25 MB. Necessário upload direto autenticado ao objeto para suportar PDFs maiores na Vercel.

## Verificação e bloqueios

27 testes de núcleo e cinco testes Node passaram; typecheck, lint e build passaram na primeira implementação. Build final também passou. Testes HTTP reais do consumidor e processamento remoto ainda pendentes de conexões do banco e bucket.

Vercel continua com APP_URL/PUBLIC_SITE_URL somente. Conector Supabase disponibiliza chave publicável, não credenciais privadas de banco/storage. Painel web abriu tela de login sem sessão autenticada. Não foram inventadas credenciais, modificadas senhas ou liberada produção. PROCESSING_DRIVER não foi ativado no provedor enquanto faltam dependências e confirmação do plano/consumo; não houve contratação paga.

## Ativação e rollback

Configurar cinco URLs de banco com papéis mínimos, bucket privado e credencial de servidor; escolher ambiente correto e testar autenticação, PDF e isolamento antes de promover. Configurar PROCESSING_DRIVER=vercel somente após esses testes. Manter provedor de IA e e-mail validados. O secret do storage jamais deve ir para NEXT_PUBLIC_.

Rollback: reverter o commit deste ciclo e redeploy; manter PDFs e jobs persistidos. Para voltar a standalone, configurar PROCESSING_DRIVER=standalone e usar worker com o mesmo backend de armazenamento. Não retirar a correção das permissões dos RPCs aplicada no ciclo anterior.
