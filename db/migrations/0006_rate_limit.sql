-- =====================================================================
-- 0006_rate_limit.sql
--
-- CORREÇÃO DO BUG-04 (alto).
-- Teste A14.1: 40 de 40 convites aceitos em rajada. Não havia nenhum
-- limite. Vetor de abuso: usar a plataforma como máquina de disparo de
-- e-mail, com o domínio do produto no remetente.
--
-- Contador no Postgres, janela deslizante por hora. Não precisa de
-- Redis nesta escala e é transacional com o resto (ADR-005).
-- =====================================================================

CREATE TABLE rate_limits (
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bucket       text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, bucket, window_start)
);
CREATE INDEX rate_limits_cleanup_idx ON rate_limits (window_start);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rate_limits
  USING (org_id = (SELECT current_org()))
  WITH CHECK (org_id = (SELECT current_org()));

GRANT SELECT, INSERT, UPDATE ON rate_limits TO app_user;

-- Consome uma unidade da janela corrente. Retorna false se estourou.
-- INSERT ... ON CONFLICT torna a operação atômica: duas requisições
-- simultâneas não conseguem ambas passar no limite.
CREATE OR REPLACE FUNCTION consume_rate_limit(
  p_bucket text, p_limit integer, p_window interval DEFAULT '1 hour'
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  w timestamptz := date_bin(p_window, now(), timestamptz 'epoch');
  c integer;
BEGIN
  INSERT INTO rate_limits (org_id, bucket, window_start, count)
  VALUES ((SELECT current_org()), p_bucket, w, 1)
  ON CONFLICT (org_id, bucket, window_start)
  DO UPDATE SET count = rate_limits.count + 1
  RETURNING count INTO c;

  RETURN c <= p_limit;
END $$;
