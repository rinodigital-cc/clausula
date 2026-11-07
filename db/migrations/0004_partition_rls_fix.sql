-- =====================================================================
-- 0004_partition_rls_fix.sql
--
-- ACHADO DO TESTE DE ISOLAMENTO (T17), na primeira execução.
--
-- Políticas de RLS NÃO são herdadas por partições no PostgreSQL.
-- Uma query através da tabela-pai aplica a policy do pai, mas uma query
-- direta à partição (audit_logs_default) não aplica policy nenhuma.
--
-- Hoje isso não é explorável, porque nunca concedemos privilégio nas
-- partições — só no pai. Mas é um furo latente que se abre no dia em
-- que alguém rodar um GRANT amplo, um script de manutenção ou um
-- "GRANT ALL ON ALL TABLES IN SCHEMA public".
--
-- Correção em duas frentes:
--   1. RLS + FORCE + policy também nas partições existentes
--   2. Função que cria partições futuras já corretas — porque a
--      partição mensal de dezembro vai ser criada por um cron, não por
--      alguém lembrando desta migração
-- =====================================================================

ALTER TABLE audit_logs_default ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs_default FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_logs_default
  USING (org_id = (SELECT current_org()))
  WITH CHECK (org_id = (SELECT current_org()));

-- Defesa adicional: nenhum papel de runtime toca partição diretamente.
REVOKE ALL ON audit_logs_default FROM app_user, app_worker;

-- ---------------------------------------------------------------------
-- Criação de partição mensal, com RLS aplicada por construção.
-- Chamada pelo job mensal de manutenção. Nunca criar partição na mão.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_audit_partition(p_month date)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  part_name text := 'audit_logs_' || to_char(p_month, 'YYYY_MM');
  start_at  date := date_trunc('month', p_month);
  end_at    date := (date_trunc('month', p_month) + interval '1 month')::date;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
    RETURN part_name || ' (já existe)';
  END IF;

  EXECUTE format(
    'CREATE TABLE %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
    part_name, start_at, end_at);

  -- Sem estas três linhas, cada partição nova reabre o furo.
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', part_name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', part_name);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %I
       USING (org_id = (SELECT current_org()))
       WITH CHECK (org_id = (SELECT current_org()))', part_name);
  EXECUTE format('REVOKE ALL ON %I FROM app_user, app_worker', part_name);

  RETURN part_name || ' (criada)';
END $$;
