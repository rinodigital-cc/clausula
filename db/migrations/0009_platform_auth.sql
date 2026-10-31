-- =====================================================================
-- 0009_platform_auth.sql  (Apoia Seguro, out/2026)
--
-- 1. Papel de PLATAFORMA (operador da Apoia Seguro): cria corretoras e
--    emite o primeiro convite. Enxerga metadados de organizações, NUNCA
--    conhecimento, conversas ou documentos. Quem prepara documentos para
--    uma corretora entra nela como membro, pelo caminho normal com RLS.
-- 2. Autenticação própria: login, sessão e recuperação de senha passam
--    pelo papel de bootstrap (o usuário ainda não tem contexto de org).
-- 3. O primeiro convite de uma corretora nova é de PROPRIETÁRIO.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Administradores da plataforma (global, sem org_id)
-- ---------------------------------------------------------------------
CREATE TABLE platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Recuperação de senha e primeiro acesso: token só em hash, uso único
-- ---------------------------------------------------------------------
CREATE TABLE password_resets (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  purpose    text NOT NULL DEFAULT 'reset' CHECK (purpose IN ('reset','first_access')),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX password_resets_token_uk ON password_resets (token_hash);
CREATE INDEX password_resets_user_idx ON password_resets (user_id) WHERE used_at IS NULL;

-- Convite de proprietário (somente a plataforma emite; a aplicação
-- continua barrando 'owner' no convite feito por dentro da corretora).
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_role_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_role_check
  CHECK (role IN ('owner','admin','member'));
-- invited_by passa a aceitar o operador da plataforma, que não é membro
-- (continua referenciando users).

-- ---------------------------------------------------------------------
-- RLS das tabelas globais novas: nada para app_user
-- ---------------------------------------------------------------------
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admins FORCE ROW LEVEL SECURITY;
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_resets FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- Bootstrap: login, sessão e senha
-- ---------------------------------------------------------------------
GRANT INSERT ON sessions TO app_bootstrap;
GRANT UPDATE (password_hash, last_seen_at, email_verified_at, name) ON users TO app_bootstrap;
GRANT SELECT ON platform_admins TO app_bootstrap;
CREATE POLICY bootstrap_read ON platform_admins TO app_bootstrap USING (true);
GRANT SELECT, INSERT, UPDATE ON password_resets TO app_bootstrap;
CREATE POLICY bootstrap_resets ON password_resets TO app_bootstrap
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- Papel de plataforma
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    CREATE ROLE app_platform NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO app_platform;

GRANT SELECT, INSERT, UPDATE (name, status, document, updated_at) ON organizations TO app_platform;
CREATE POLICY platform_all ON organizations TO app_platform USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON memberships TO app_platform;
CREATE POLICY platform_all ON memberships TO app_platform USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON invitations TO app_platform;
CREATE POLICY platform_all ON invitations TO app_platform USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON users TO app_platform;
CREATE POLICY platform_all ON users TO app_platform USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON platform_admins TO app_platform;
CREATE POLICY platform_all ON platform_admins TO app_platform USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON password_resets TO app_platform;
CREATE POLICY platform_all ON password_resets TO app_platform USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON audit_logs TO app_platform;
REVOKE UPDATE, DELETE ON audit_logs FROM app_platform;
CREATE POLICY platform_all ON audit_logs TO app_platform USING (true) WITH CHECK (true);

-- Cria o assistente padrão da corretora (metadado, sem conhecimento)
GRANT SELECT, INSERT ON specialists TO app_platform;
CREATE POLICY platform_all ON specialists TO app_platform USING (true) WITH CHECK (true);

-- Contagens agregadas para a visão da plataforma: só metadado de versão
GRANT SELECT (id, org_id, status, created_at) ON source_versions TO app_platform;
CREATE POLICY platform_read ON source_versions TO app_platform USING (true);

-- Explicitamente NEGADO à plataforma: chunks, conteúdo, conversas,
-- notificações e sessões. Cada tabela nova nasce negada.
REVOKE ALL ON chunks, chunk_embeddings, knowledge_sources, notifications, sessions
  FROM app_platform;
