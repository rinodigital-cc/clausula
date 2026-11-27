-- =====================================================================
-- 0018_email_delivery.sql — rastreabilidade de entrega e limites de envio
--
-- Aditiva: não apaga nem reescreve dados existentes.
--
-- 1. email_outbox ganha o identificador do provedor e o estado de ENTREGA,
--    separado do estado de DESPACHO. "sent" = aceito pelo Resend; entrega
--    só é afirmada quando o provedor informar "delivered".
-- 2. email_events guarda eventos do provedor (webhook ou consulta),
--    idempotentes pelo identificador do evento.
-- 3. email_limits + consume_email_limit(): limite de pedidos de envio por
--    chave (recuperação por e-mail, reenvio por corretora, teto diário),
--    para evitar abuso e consumo da franquia gratuita.
-- 4. O operador da plataforma vê METADADOS do envio (nunca corpo/link).
-- =====================================================================

ALTER TABLE email_outbox
  ADD COLUMN provider            text,
  ADD COLUMN provider_message_id text,
  ADD COLUMN delivery_status     text
    CHECK (delivery_status IN ('accepted','delivered','delivery_delayed','bounced','complained','failed','suppressed')),
  ADD COLUMN delivered_at        timestamptz,
  ADD COLUMN last_event_at       timestamptz,
  ADD COLUMN invitation_id       uuid REFERENCES invitations(id) ON DELETE SET NULL,
  ADD COLUMN next_attempt_at     timestamptz;

CREATE UNIQUE INDEX email_outbox_provider_msg_idx ON email_outbox (provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX email_outbox_org_idx ON email_outbox (org_id, created_at DESC);
CREATE INDEX email_outbox_invitation_idx ON email_outbox (invitation_id) WHERE invitation_id IS NOT NULL;
-- Desempenho: teto diário (conta envios nas últimas 24 h) e sincronização de status.
CREATE INDEX email_outbox_sent_idx ON email_outbox (sent_at) WHERE sent_at IS NOT NULL;
CREATE INDEX email_outbox_awaiting_delivery_idx ON email_outbox (sent_at DESC)
  WHERE provider = 'resend' AND delivery_status IN ('accepted','delivery_delayed');

CREATE TABLE email_events (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  provider_event_id text NOT NULL UNIQUE,
  outbox_id         uuid REFERENCES email_outbox(id) ON DELETE CASCADE,
  type              text NOT NULL,
  occurred_at       timestamptz,
  received_at       timestamptz NOT NULL DEFAULT now(),
  detail            text
);
CREATE INDEX email_events_outbox_idx ON email_events (outbox_id, received_at DESC);
ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_events FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON email_events TO app_worker;
CREATE POLICY worker_events ON email_events TO app_worker USING (true) WITH CHECK (true);
GRANT SELECT ON email_events TO app_platform;
CREATE POLICY platform_read_events ON email_events FOR SELECT TO app_platform USING (true);

-- Operador da plataforma: somente colunas de metadados (sem assunto, corpo ou link).
GRANT SELECT (id, org_id, to_email, kind, status, attempts, last_error, created_at, sent_at,
              provider, provider_message_id, delivery_status, delivered_at, last_event_at,
              invitation_id, next_attempt_at)
  ON email_outbox TO app_platform;
CREATE POLICY platform_read_meta ON email_outbox FOR SELECT TO app_platform USING (true);

-- Limites de pedidos de envio (chave opaca: nunca o e-mail em claro).
CREATE TABLE email_limits (
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX email_limits_cleanup_idx ON email_limits (window_start);
-- RLS ligado e sem GRANT direto: acesso só pela função abaixo (o dono da
-- função, que é o dono da tabela, não é afetado sem FORCE).
ALTER TABLE email_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION consume_email_limit(p_key text, p_limit integer, p_window interval)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  w timestamptz := date_bin(p_window, now(), timestamptz 'epoch');
  c integer;
BEGIN
  IF p_key IS NULL OR length(p_key) > 200 OR p_limit < 1 THEN
    RAISE EXCEPTION 'parâmetros de limite inválidos';
  END IF;
  INSERT INTO public.email_limits (key, window_start, count)
  VALUES (p_key, w, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET count = public.email_limits.count + 1
  RETURNING count INTO c;
  DELETE FROM public.email_limits WHERE window_start < now() - interval '3 days';
  RETURN c <= p_limit;
END $$;
REVOKE ALL ON FUNCTION consume_email_limit(text, integer, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_email_limit(text, integer, interval) TO app_user, app_bootstrap, app_platform, app_worker;
