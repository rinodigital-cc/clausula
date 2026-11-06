-- =====================================================================
-- 0012_leads_outbox.sql  (Apoia Seguro, out/2026)
--
-- 1. Leads do site público. Papel `app_public` só INSERE: o formulário
--    do site não consegue ler um único lead de volta, nem de si mesmo.
-- 2. Caixa de saída de e-mail (padrão outbox). O convite é gravado na
--    mesma transação da intenção de enviar; se o provedor estiver fora
--    do ar ou não configurado, nada se perde em silêncio.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_public') THEN
    CREATE ROLE app_public NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO app_public;

CREATE TABLE leads (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  email           citext NOT NULL CHECK (length(email) <= 254),
  company         text CHECK (company IS NULL OR length(company) <= 160),
  phone           text CHECK (phone IS NULL OR length(phone) <= 40),
  team_size       text CHECK (team_size IS NULL OR team_size IN ('1','2-5','6-20','21-50','50+')),
  interest        text NOT NULL DEFAULT 'demonstracao'
                  CHECK (interest IN ('demonstracao','piloto','contato')),
  message         text CHECK (message IS NULL OR length(message) <= 2000),
  consent_at      timestamptz NOT NULL,
  consent_version text NOT NULL,
  source_path     text,
  ip_hash         text,
  user_agent      text,
  status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','discarded')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_created_idx ON leads (created_at DESC);

CREATE TABLE lead_rate_limits (
  ip_hash      text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, window_start)
);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE ROW LEVEL SECURITY;
ALTER TABLE lead_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_rate_limits FORCE ROW LEVEL SECURITY;

GRANT INSERT ON leads TO app_public;
CREATE POLICY public_insert ON leads FOR INSERT TO app_public WITH CHECK (status = 'new');

-- Limite por IP: função definidora, o papel público não lê a tabela
CREATE OR REPLACE FUNCTION consume_lead_quota(p_ip_hash text, p_limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w timestamptz := date_bin(interval '1 hour', now(), timestamptz 'epoch'); c integer;
BEGIN
  INSERT INTO lead_rate_limits (ip_hash, window_start, count) VALUES (p_ip_hash, w, 1)
  ON CONFLICT (ip_hash, window_start) DO UPDATE SET count = lead_rate_limits.count + 1
  RETURNING count INTO c;
  RETURN c <= p_limit;
END $$;
REVOKE ALL ON FUNCTION consume_lead_quota(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_lead_quota(text, integer) TO app_public;

GRANT SELECT, UPDATE (status) ON leads TO app_platform;
CREATE POLICY platform_all ON leads TO app_platform USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- Caixa de saída de e-mail
-- ---------------------------------------------------------------------
CREATE TABLE email_outbox (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id      uuid REFERENCES organizations(id) ON DELETE CASCADE,
  to_email    citext NOT NULL,
  kind        text NOT NULL,
  subject     text NOT NULL,
  body_text   text NOT NULL,
  body_html   text NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','sent','failed','skipped')),
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX email_outbox_pending_idx ON email_outbox (created_at) WHERE status = 'pending';

ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_insert ON email_outbox FOR INSERT TO app_user
  WITH CHECK (org_id = (SELECT current_org()));
GRANT INSERT ON email_outbox TO app_user;

GRANT INSERT ON email_outbox TO app_bootstrap, app_platform;
CREATE POLICY privileged_insert ON email_outbox FOR INSERT TO app_bootstrap, app_platform
  WITH CHECK (true);

-- Despacho: só o worker lê a caixa (o corpo pode conter link de convite)
GRANT SELECT, UPDATE ON email_outbox TO app_worker;
CREATE POLICY worker_dispatch ON email_outbox TO app_worker USING (true) WITH CHECK (true);
