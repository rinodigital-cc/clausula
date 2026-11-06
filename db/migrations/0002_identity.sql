-- =====================================================================
-- 0002_identity.sql
-- Organizações, usuários, membros, convites, sessões, auditoria,
-- notificações. Escopo do Milestone 1.
-- =====================================================================

-- ---------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------
CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  slug       citext NOT NULL,
  document   text,
  logo_url   text,
  timezone   text NOT NULL DEFAULT 'America/Sao_Paulo',
  status     text NOT NULL DEFAULT 'trial'
             CHECK (status IN ('trial','active','past_due','suspended','cancelled')),
  settings   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX organizations_slug_uk
  ON organizations (slug) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX organizations_document_uk
  ON organizations (document) WHERE deleted_at IS NULL AND document IS NOT NULL;
CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- users
-- GLOBAL por desenho: uma pessoa pode pertencer a duas corretoras.
-- Única tabela de negócio sem org_id — e por isso a única sem RLS de
-- tenant. O acesso é mediado por memberships.
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  email             citext NOT NULL,
  name              text NOT NULL,
  avatar_url        text,
  password_hash     text,
  email_verified_at timestamptz,
  last_seen_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE UNIQUE INDEX users_email_uk ON users (email) WHERE deleted_at IS NULL;
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- memberships
-- ---------------------------------------------------------------------
CREATE TABLE memberships (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner','admin','member')),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  invited_by uuid REFERENCES users(id),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memberships_org_uk UNIQUE (org_id, id)
);
CREATE UNIQUE INDEX memberships_org_user_uk ON memberships (org_id, user_id);
CREATE INDEX memberships_user_idx ON memberships (user_id) WHERE status = 'active';
CREATE UNIQUE INDEX memberships_single_owner
  ON memberships (org_id) WHERE role = 'owner' AND status = 'active';
CREATE TRIGGER memberships_updated_at BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- invitations
-- Token guardado APENAS em hash (Threat Model R-22).
-- ---------------------------------------------------------------------
CREATE TABLE invitations (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       citext NOT NULL,
  role        text NOT NULL CHECK (role IN ('admin','member')),
  token_hash  text NOT NULL,
  invited_by  uuid NOT NULL REFERENCES users(id),
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invitations_pending_uk
  ON invitations (org_id, email) WHERE accepted_at IS NULL;
CREATE UNIQUE INDEX invitations_token_uk ON invitations (token_hash);
CREATE INDEX invitations_expiry_idx
  ON invitations (expires_at) WHERE accepted_at IS NULL;
CREATE TRIGGER invitations_updated_at BEFORE UPDATE ON invitations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- sessions
-- active_org_id: a organização "corrente" da sessão. É a ÚNICA origem
-- de org_id em runtime (Threat Model: nunca de parâmetro de requisição).
-- ---------------------------------------------------------------------
CREATE TABLE sessions (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash     text NOT NULL,
  active_org_id  uuid REFERENCES organizations(id) ON DELETE SET NULL,
  ip_address     inet,
  user_agent     text,
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sessions_token_uk ON sessions (token_hash);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry_idx ON sessions (expires_at) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------
-- audit_logs
-- Somente-inserção imposto pelo BANCO, não pela aplicação (R-26).
-- Particionada desde já: é tabela de alto crescimento e reparticionar
-- com dado de cliente dentro é a migração mais dolorosa que existe.
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  id          uuid NOT NULL DEFAULT uuidv7(),
  org_id      uuid NOT NULL,
  actor_id    uuid,
  actor_type  text NOT NULL DEFAULT 'user'
              CHECK (actor_type IN ('user','system','api_key')),
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address  inet,
  user_agent  text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;
CREATE INDEX audit_logs_org_time_idx ON audit_logs (org_id, occurred_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (org_id, entity_type, entity_id);

-- ---------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  title      text NOT NULL,
  body       text,
  link_url   text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_unread_idx
  ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
