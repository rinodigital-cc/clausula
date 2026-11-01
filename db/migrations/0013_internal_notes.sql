-- =====================================================================
-- 0013_internal_notes.sql  (Apoia Seguro, out/2026)
--
-- Conhecimento interno (resposta a uma lacuna) é texto escrito na própria
-- aplicação: vira trecho citável na hora, sem passar pela fila. A página
-- do visualizador é gravada pela aplicação, sob a RLS da corretora.
-- =====================================================================
GRANT INSERT ON document_pages TO app_user;

-- Notificação é da pessoa, não da corretora inteira. A policy herdada
-- (tenant_isolation) deixava qualquer membro ler as notificações dos
-- colegas; esta policy RESTRITIVA soma a condição de dono na leitura.
CREATE POLICY own_notifications_only ON notifications AS RESTRICTIVE FOR SELECT TO app_user
  USING (user_id = (SELECT current_actor()));
