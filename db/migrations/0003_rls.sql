-- =====================================================================
-- 0003_rls.sql
-- Isolamento multi-tenant. Threat Model R-01..R-04, R-11.
--
-- Três invariantes:
--   1. FORCE ROW LEVEL SECURITY  — sem isso o dono da tabela ignora a
--      policy, e o dono é exatamente quem roda migração e diagnóstico.
--   2. (SELECT current_org())    — subconsulta faz o planner avaliar uma
--      vez por query, não uma vez por linha.
--   3. WITH CHECK igual ao USING — impede INSERT/UPDATE cravando outro
--      org_id. Sem isso, a policy protege leitura mas não escrita.
-- =====================================================================

-- ---------------------------------------------------------------------
-- organizations: a própria linha da org corrente
-- ---------------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organizations
  USING (id = (SELECT current_org()))
  WITH CHECK (id = (SELECT current_org()));

-- ---------------------------------------------------------------------
-- Tabelas com org_id
-- ---------------------------------------------------------------------
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON memberships
  USING (org_id = (SELECT current_org()))
  WITH CHECK (org_id = (SELECT current_org()));

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitations
  USING (org_id = (SELECT current_org()))
  WITH CHECK (org_id = (SELECT current_org()));

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_logs
  USING (org_id = (SELECT current_org()))
  WITH CHECK (org_id = (SELECT current_org()));

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications
  USING (org_id = (SELECT current_org()))
  WITH CHECK (org_id = (SELECT current_org()));

-- ---------------------------------------------------------------------
-- users: sem org_id. Só é visível quem compartilha organização com a
-- org corrente. É o que impede varrer a base de usuários da plataforma.
-- ---------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY member_of_current_org ON users
  USING (
    EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = users.id
        AND m.org_id = (SELECT current_org())
    )
  )
  WITH CHECK (true);   -- criação de usuário passa por caminho privilegiado

-- ---------------------------------------------------------------------
-- sessions: só as do próprio usuário
-- ---------------------------------------------------------------------
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY own_sessions ON sessions
  USING (user_id = (SELECT current_actor()))
  WITH CHECK (user_id = (SELECT current_actor()));

-- =====================================================================
-- GRANTS
-- =====================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON
  organizations, memberships, invitations, notifications TO app_user;

GRANT SELECT, UPDATE ON users TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO app_user;

-- Auditoria é append-only no nível do banco (R-26).
GRANT SELECT, INSERT ON audit_logs TO app_user;
REVOKE UPDATE, DELETE ON audit_logs FROM app_user;

-- ---------------------------------------------------------------------
-- app_worker: fronteira F5 do threat model.
-- Roda SEM RLS por necessidade operacional, e por isso recebe o menor
-- escopo possível. No Milestone 1 não há nada de conhecimento ainda —
-- ele só pode escrever notificação e auditoria. Nenhum acesso a users,
-- sessions ou invitations.
-- ---------------------------------------------------------------------
GRANT SELECT ON organizations TO app_worker;
GRANT SELECT, INSERT ON notifications TO app_worker;
GRANT SELECT, INSERT ON audit_logs TO app_worker;
REVOKE UPDATE, DELETE ON audit_logs FROM app_worker;
