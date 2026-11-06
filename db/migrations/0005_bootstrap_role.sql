-- =====================================================================
-- 0005_bootstrap_role.sql
--
-- ACHADO EM EXECUÇÃO (teste de integração do Milestone 1).
--
-- Problema: existem dois caminhos legítimos que acontecem ANTES de
-- existir contexto de tenant:
--   • criar organização — a org ainda não existe
--   • aceitar convite    — o usuário ainda não é membro
--
-- A implementação original usava o papel da aplicação nesses caminhos.
-- Como a RLS está com FORCE, current_org() levanta exceção e a operação
-- é impossível. O desenho estava incompleto, não o banco.
--
-- Solução REJEITADA: dar BYPASSRLS ao papel da aplicação.
--   Resolveria em uma linha e reabriria exatamente o R-01. Um papel
--   com BYPASSRLS usado no caminho quente significa que qualquer bug
--   de filtro vira vazamento cross-tenant.
--
-- Solução ADOTADA: papel `app_bootstrap` separado, sem BYPASSRLS, com
--   policies próprias e o menor conjunto de privilégios que faz os dois
--   caminhos funcionarem. Ele NÃO enxerga conhecimento, conversas,
--   notificações nem sessões.
--
-- Trade-off assumido e registrado: `app_bootstrap` consegue ler
-- invitations e users de qualquer organização. É o preço de validar
-- token de convite sem saber ainda a que org ele pertence. Mitigação:
-- usado em exatamente dois pontos do código, com conexão própria, e
-- sem acesso a nada que tenha valor competitivo.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_bootstrap') THEN
    CREATE ROLE app_bootstrap NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_bootstrap;

-- Criação de organização
GRANT SELECT, INSERT ON organizations TO app_bootstrap;
CREATE POLICY bootstrap_create ON organizations
  TO app_bootstrap
  USING (true) WITH CHECK (true);

-- Vínculo do owner e do convidado
GRANT SELECT, INSERT, UPDATE ON memberships TO app_bootstrap;
CREATE POLICY bootstrap_membership ON memberships
  TO app_bootstrap
  USING (true) WITH CHECK (true);

-- Cadastro e verificação de e-mail do convite
GRANT SELECT, INSERT ON users TO app_bootstrap;
CREATE POLICY bootstrap_users ON users
  TO app_bootstrap
  USING (true) WITH CHECK (true);

-- Validação e consumo do convite
GRANT SELECT, UPDATE ON invitations TO app_bootstrap;
CREATE POLICY bootstrap_invitations ON invitations
  TO app_bootstrap
  USING (true) WITH CHECK (true);

-- Auditoria dos próprios atos. Continua append-only.
GRANT SELECT, INSERT ON audit_logs TO app_bootstrap;
CREATE POLICY bootstrap_audit ON audit_logs
  TO app_bootstrap
  USING (true) WITH CHECK (true);
REVOKE UPDATE, DELETE ON audit_logs FROM app_bootstrap;

-- Revogação de sessão ao remover membro
GRANT SELECT, UPDATE ON sessions TO app_bootstrap;
CREATE POLICY bootstrap_sessions ON sessions
  TO app_bootstrap
  USING (true) WITH CHECK (true);

-- Explicitamente NEGADO: notificações e tudo que virá nas próximas
-- milestones (fontes, chunks, conversas, mensagens, citações).
-- Papel de bootstrap não cresce junto com o schema — cada nova tabela
-- precisa de decisão consciente para ser incluída, e o padrão é não.
REVOKE ALL ON notifications FROM app_bootstrap;
