-- =====================================================================
-- 0011_conversations.sql  (Apoia Seguro, out/2026)
--
-- Consultas, mensagens, citações, feedback, lacunas e uso.
--
-- Regra de visibilidade da conversa: o corretor vê SÓ as próprias; o
-- administrador da corretora vê as da corretora (qualidade e auditoria).
-- A regra mora no banco, não só na tela.
-- =====================================================================

-- Papel do ator na organização corrente (lido sob a própria RLS)
CREATE OR REPLACE FUNCTION current_org_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT m.role FROM memberships m
  WHERE m.org_id = (SELECT current_org())
    AND m.user_id = (SELECT current_actor())
    AND m.status = 'active'
$$;

CREATE TABLE conversations (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  specialist_id uuid NOT NULL,
  title         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_org_uk UNIQUE (org_id, id),
  FOREIGN KEY (org_id, specialist_id) REFERENCES specialists (org_id, id) ON DELETE CASCADE
);
CREATE INDEX conversations_user_idx ON conversations (org_id, user_id, updated_at DESC);
CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id          uuid NOT NULL,
  conversation_id uuid NOT NULL,
  user_id         uuid NOT NULL REFERENCES users(id),
  question        text NOT NULL,
  status          text NOT NULL
                  CHECK (status IN ('answered','partial','conflict','not_found','error')),
  confidence      text NOT NULL CHECK (confidence IN ('strong','partial','not_found')),
  summary         text NOT NULL,
  answer          jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings        jsonb NOT NULL DEFAULT '[]'::jsonb,
  mode            text NOT NULL CHECK (mode IN ('generative','extractive')),
  model           text,
  latency_ms      integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_org_uk UNIQUE (org_id, id),
  FOREIGN KEY (org_id, conversation_id) REFERENCES conversations (org_id, id) ON DELETE CASCADE
);
CREATE INDEX messages_conv_idx ON messages (conversation_id, created_at);

-- Citação guarda um RETRATO do trecho: o histórico precisa continuar
-- provando o que foi informado mesmo se o documento for substituído.
CREATE TABLE message_citations (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  message_id        uuid NOT NULL,
  ordinal           integer NOT NULL,
  chunk_id          uuid,
  source_version_id uuid,
  source_title      text NOT NULL,
  insurer_name      text,
  product_name      text,
  version_number    integer,
  clause_path       text,
  clause_title      text,
  page_number       integer,
  section_kind      text,
  quote             text NOT NULL,
  FOREIGN KEY (org_id, message_id) REFERENCES messages (org_id, id) ON DELETE CASCADE
);
CREATE INDEX message_citations_msg_idx ON message_citations (message_id, ordinal);

CREATE TABLE feedback (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id     uuid NOT NULL,
  message_id uuid NOT NULL,
  user_id    uuid NOT NULL REFERENCES users(id),
  rating     text NOT NULL CHECK (rating IN ('useful','incomplete','wrong')),
  comment    text CHECK (comment IS NULL OR length(comment) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, message_id) REFERENCES messages (org_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX feedback_once_uk ON feedback (message_id, user_id);

CREATE TABLE knowledge_gaps (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  question         text NOT NULL,
  normalized       text NOT NULL,
  first_asked_by   uuid REFERENCES users(id),
  ask_count        integer NOT NULL DEFAULT 1,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  resolution_note  text,
  resolved_by      uuid REFERENCES users(id),
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX knowledge_gaps_open_uk ON knowledge_gaps (org_id, normalized) WHERE status = 'open';
CREATE TRIGGER knowledge_gaps_updated_at BEFORE UPDATE ON knowledge_gaps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE usage_events (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id),
  kind       text NOT NULL,
  tokens_in  integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  cost_brl   numeric(12,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_events_org_day_idx ON usage_events (org_id, created_at);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conversations','messages','message_citations','feedback',
                           'knowledge_gaps','usage_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Conversa e mensagem: dona ou administração da mesma corretora
CREATE POLICY own_or_admin ON conversations
  USING (org_id = (SELECT current_org())
         AND (user_id = (SELECT current_actor())
              OR (SELECT current_org_role()) IN ('owner','admin')))
  WITH CHECK (org_id = (SELECT current_org()) AND user_id = (SELECT current_actor()));

CREATE POLICY own_or_admin ON messages
  USING (org_id = (SELECT current_org())
         AND (user_id = (SELECT current_actor())
              OR (SELECT current_org_role()) IN ('owner','admin')))
  WITH CHECK (org_id = (SELECT current_org()) AND user_id = (SELECT current_actor()));

-- Citação herda a visibilidade da mensagem (a subconsulta passa pela RLS de messages)
CREATE POLICY via_message ON message_citations
  USING (org_id = (SELECT current_org())
         AND EXISTS (SELECT 1 FROM messages m WHERE m.id = message_citations.message_id))
  WITH CHECK (org_id = (SELECT current_org()));

CREATE POLICY own_or_admin ON feedback
  USING (org_id = (SELECT current_org())
         AND (user_id = (SELECT current_actor())
              OR (SELECT current_org_role()) IN ('owner','admin')))
  WITH CHECK (org_id = (SELECT current_org()) AND user_id = (SELECT current_actor()));

CREATE POLICY tenant_isolation ON knowledge_gaps
  USING (org_id = (SELECT current_org()))
  WITH CHECK (org_id = (SELECT current_org()));

CREATE POLICY tenant_isolation ON usage_events
  USING (org_id = (SELECT current_org()))
  WITH CHECK (org_id = (SELECT current_org()));

GRANT SELECT, INSERT, UPDATE ON conversations TO app_user;
GRANT SELECT, INSERT ON messages, message_citations TO app_user;
GRANT SELECT, INSERT, UPDATE ON feedback TO app_user;
GRANT SELECT, INSERT, UPDATE ON knowledge_gaps TO app_user;
GRANT SELECT, INSERT ON usage_events TO app_user;
