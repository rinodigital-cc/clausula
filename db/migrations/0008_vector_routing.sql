-- =====================================================================
-- 0008_vector_routing.sql
--
-- Correção do P1, medida experimentalmente (ver P1-FINDINGS.md).
--
-- Fato observado com 250.000 chunks e 50 organizações: uma organização
-- com 4% do corpus pediu top-10 e recebeu ZERO linhas — para uma
-- consulta cujo vizinho mais próximo era um vetor dela mesma. O grafo
-- HNSW é global; ele percorre e só então aplica o filtro por org.
--
-- `hnsw.iterative_scan` NÃO resolve. Testado em relaxed_order e
-- strict_order, com max_scan_tuples até 100.000 e scan_mem_multiplier
-- até 32: zero linhas em todos os casos.
--
-- O que resolve é isolamento FÍSICO do grafo: índice HNSW parcial por
-- organização. E, abaixo de um limiar, varredura exata — que é mais
-- rápida E exata para acervo pequeno.
-- =====================================================================

CREATE TABLE org_vector_strategy (
  org_id        uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  strategy      text NOT NULL DEFAULT 'exact'
                CHECK (strategy IN ('exact','dedicated_index')),
  chunk_count   bigint NOT NULL DEFAULT 0,
  index_name    text,
  indexed_at    timestamptz,
  evaluated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE org_vector_strategy ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_vector_strategy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON org_vector_strategy
  USING (org_id = (SELECT current_org()));
GRANT SELECT ON org_vector_strategy TO app_user;
GRANT SELECT, INSERT, UPDATE ON org_vector_strategy TO app_worker;

-- Limiar de virada. 50.000 é o ponto observado no hardware de teste;
-- PRECISA ser remedido no ambiente real antes de valer como número.
CREATE OR REPLACE FUNCTION vector_strategy_threshold() RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$ SELECT 50000::bigint $$;

/**
 * Reavalia a estratégia de uma organização e cria ou remove o índice
 * dedicado conforme o acervo cruza o limiar.
 *
 * Chamada por job após ingestão, nunca no caminho síncrono: CREATE
 * INDEX em centenas de milhares de linhas leva minutos e não pode
 * bloquear um upload.
 */
CREATE OR REPLACE FUNCTION refresh_vector_strategy(p_org uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  n        bigint;
  idx      text := 'chunk_emb_hnsw_' || replace(p_org::text, '-', '');
  existing text;
BEGIN
  SELECT count(*) INTO n FROM chunk_embeddings WHERE org_id = p_org;
  SELECT index_name INTO existing FROM org_vector_strategy WHERE org_id = p_org;

  IF n >= vector_strategy_threshold() THEN
    IF existing IS NULL THEN
      -- CONCURRENTLY não pode rodar dentro de função; o job chama esta
      -- função para decidir e executa o DDL fora da transação.
      EXECUTE format(
        'CREATE INDEX %I ON chunk_embeddings
           USING hnsw (embedding vector_cosine_ops)
           WITH (m = 16, ef_construction = 64)
           WHERE org_id = %L', idx, p_org);
    END IF;

    INSERT INTO org_vector_strategy
      (org_id, strategy, chunk_count, index_name, indexed_at, evaluated_at)
    VALUES (p_org, 'dedicated_index', n, idx, now(), now())
    ON CONFLICT (org_id) DO UPDATE SET
      strategy = 'dedicated_index', chunk_count = n,
      index_name = idx, indexed_at = coalesce(org_vector_strategy.indexed_at, now()),
      evaluated_at = now();

    RETURN 'dedicated_index';
  END IF;

  IF existing IS NOT NULL THEN
    EXECUTE format('DROP INDEX IF EXISTS %I', existing);
  END IF;

  INSERT INTO org_vector_strategy (org_id, strategy, chunk_count, evaluated_at)
  VALUES (p_org, 'exact', n, now())
  ON CONFLICT (org_id) DO UPDATE SET
    strategy = 'exact', chunk_count = n,
    index_name = NULL, indexed_at = NULL, evaluated_at = now();

  RETURN 'exact';
END $$;

/**
 * Sentinela de regressão.
 *
 * Devolve as organizações cuja busca vetorial devolveria MENOS
 * resultados que o pedido. É a métrica que o PRD manda vigiar —
 * "recall do golden set por tamanho de organização" — em forma
 * executável.
 *
 * Um valor não-vazio aqui significa que alguma corretora está
 * recebendo "não encontrei" para perguntas que têm resposta.
 */
CREATE OR REPLACE FUNCTION vector_health_check(p_k integer DEFAULT 10)
RETURNS TABLE (org_id uuid, chunks bigint, strategy text, returned integer, healthy boolean)
LANGUAGE plpgsql AS $$
DECLARE r record; q vector(384); got integer;
BEGIN
  FOR r IN
    SELECT s.org_id, s.chunk_count, s.strategy
    FROM org_vector_strategy s WHERE s.chunk_count > 0
  LOOP
    SELECT e.embedding INTO q FROM chunk_embeddings e
    WHERE e.org_id = r.org_id LIMIT 1;

    EXECUTE format(
      'SELECT count(*)::int FROM (
         SELECT 1 FROM chunk_embeddings
         WHERE org_id = %L ORDER BY embedding <=> %L LIMIT %s) t',
      r.org_id, q, p_k) INTO got;

    org_id := r.org_id; chunks := r.chunk_count; strategy := r.strategy;
    returned := got; healthy := (got >= least(p_k, r.chunk_count));
    RETURN NEXT;
  END LOOP;
END $$;
