-- =====================================================================
-- 0010_catalog_ingestion.sql  (Apoia Seguro, out/2026)
--
-- Catálogo de seguradoras e produtos por corretora, metadados de
-- documento (tipo, vigência, direitos de uso), páginas extraídas para
-- o visualizador e fila de ingestão no próprio Postgres.
--
-- A fila usa FOR UPDATE SKIP LOCKED dentro de uma função SECURITY
-- DEFINER que devolve o org_id do trabalho: o worker só enxerga dado
-- de uma corretora DEPOIS de definir o contexto dela, e a RLS continua
-- valendo para ele.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Seguradoras e produtos (por corretora)
-- ---------------------------------------------------------------------
CREATE TABLE insurers (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insurers_org_uk UNIQUE (org_id, id)
);
CREATE UNIQUE INDEX insurers_name_uk ON insurers (org_id, lower(name));

CREATE TABLE products (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id     uuid NOT NULL,
  insurer_id uuid NOT NULL,
  name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  line       text NOT NULL DEFAULT 'outros'
             CHECK (line IN ('residencial','automovel','vida','empresarial',
                             'condominio','saude','previdencia','viagem','outros')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_org_uk UNIQUE (org_id, id),
  FOREIGN KEY (org_id, insurer_id) REFERENCES insurers (org_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX products_name_uk ON products (org_id, insurer_id, lower(name));

-- ---------------------------------------------------------------------
-- Metadados de documento
-- ---------------------------------------------------------------------
ALTER TABLE knowledge_sources
  ADD COLUMN insurer_id uuid,
  ADD COLUMN product_id uuid,
  ADD COLUMN doc_type text NOT NULL DEFAULT 'condicoes_gerais'
      CHECK (doc_type IN ('condicoes_gerais','manual','procedimento','tabela','nota_interna','outro')),
  ADD COLUMN rights_confirmed_by uuid REFERENCES users(id),
  ADD COLUMN rights_confirmed_at timestamptz,
  ADD CONSTRAINT ks_insurer_fk FOREIGN KEY (org_id, insurer_id)
      REFERENCES insurers (org_id, id) ON DELETE SET NULL (insurer_id),
  ADD CONSTRAINT ks_product_fk FOREIGN KEY (org_id, product_id)
      REFERENCES products (org_id, id) ON DELETE SET NULL (product_id);
CREATE INDEX ks_org_insurer_idx ON knowledge_sources (org_id, insurer_id);

ALTER TABLE source_versions
  ADD COLUMN file_size     bigint,
  ADD COLUMN mime_type     text,
  ADD COLUMN stage         text,
  ADD COLUMN error_message text,
  ADD COLUMN uploaded_by   uuid REFERENCES users(id),
  ADD COLUMN processed_at  timestamptz,
  ADD COLUMN chunk_count   integer NOT NULL DEFAULT 0;

ALTER TABLE chunks
  ADD COLUMN heading_trail text,
  ADD COLUMN suspicious    boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------
-- Páginas extraídas (visualizador lateral e "abrir original")
-- ---------------------------------------------------------------------
CREATE TABLE document_pages (
  org_id            uuid NOT NULL,
  source_version_id uuid NOT NULL,
  page_number       integer NOT NULL CHECK (page_number >= 1),
  content           text NOT NULL,
  PRIMARY KEY (source_version_id, page_number),
  FOREIGN KEY (org_id, source_version_id) REFERENCES source_versions (org_id, id) ON DELETE CASCADE
);
CREATE INDEX document_pages_org_idx ON document_pages (org_id);

-- ---------------------------------------------------------------------
-- Fila de ingestão
-- ---------------------------------------------------------------------
CREATE TABLE ingestion_jobs (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  source_version_id uuid NOT NULL,
  status            text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','done','failed')),
  attempts          integer NOT NULL DEFAULT 0,
  max_attempts      integer NOT NULL DEFAULT 3,
  run_after         timestamptz NOT NULL DEFAULT now(),
  locked_at         timestamptz,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, source_version_id) REFERENCES source_versions (org_id, id) ON DELETE CASCADE
);
CREATE INDEX ingestion_jobs_ready_idx ON ingestion_jobs (run_after)
  WHERE status IN ('queued','running');
CREATE TRIGGER ingestion_jobs_updated_at BEFORE UPDATE ON ingestion_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- RLS das tabelas novas
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['insurers','products','document_pages','ingestion_jobs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (org_id = (SELECT current_org()))
         WITH CHECK (org_id = (SELECT current_org()))', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON insurers, products TO app_user;
GRANT SELECT ON document_pages TO app_user;
GRANT SELECT, INSERT, UPDATE ON ingestion_jobs TO app_user;

-- Plataforma pode semear o catálogo inicial de uma corretora nova
GRANT SELECT, INSERT ON insurers, products TO app_platform;
CREATE POLICY platform_all ON insurers TO app_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON products TO app_platform USING (true) WITH CHECK (true);

-- Worker: o mínimo para ingerir e REPROCESSAR (a falta do DELETE foi o
-- bug nº 1 da rodada de setembro: toda reingestão falhava)
GRANT SELECT ON insurers, products TO app_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_pages TO app_worker;
GRANT DELETE ON chunks, chunk_embeddings TO app_worker;
GRANT SELECT, UPDATE ON ingestion_jobs TO app_worker;

-- ---------------------------------------------------------------------
-- Reserva de trabalho. SECURITY DEFINER: enxerga a fila de todas as
-- corretoras, devolve UM trabalho com seu org_id. search_path fixo para
-- não ser sequestrado por objeto homônimo em outro schema.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_ingestion_job()
RETURNS TABLE (job_id uuid, org_id uuid, source_version_id uuid, attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j record;
BEGIN
  SELECT q.id, q.org_id, q.source_version_id, q.attempts
    INTO j
  FROM ingestion_jobs q
  WHERE (q.status = 'queued' AND q.run_after <= now())
     OR (q.status = 'running' AND q.locked_at < now() - interval '10 minutes')
  ORDER BY q.run_after
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE ingestion_jobs
     SET status = 'running', locked_at = now(), attempts = ingestion_jobs.attempts + 1
   WHERE id = j.id;

  job_id := j.id; org_id := j.org_id; source_version_id := j.source_version_id;
  attempts := j.attempts + 1;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION claim_ingestion_job() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_ingestion_job() TO app_worker;
