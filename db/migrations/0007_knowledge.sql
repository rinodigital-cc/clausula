-- =====================================================================
-- 0007_knowledge.sql
-- Fontes, versões, chunks e embeddings. Base das milestones 2 e 3.
-- Segue o modelo de dados: FK composta (org_id, id) em toda relação.
-- =====================================================================

CREATE TABLE specialists (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  description       text,
  branch            text NOT NULL,
  insurers          text[] NOT NULL DEFAULT '{}',
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','published','archived')),
  config            jsonb NOT NULL DEFAULT '{}'::jsonb,
  knowledge_version bigint NOT NULL DEFAULT 0,
  published_at      timestamptz,
  created_by        uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT specialists_org_uk UNIQUE (org_id, id),
  CONSTRAINT specialists_published_chk
    CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE INDEX specialists_org_idx ON specialists (org_id) WHERE deleted_at IS NULL;
CREATE TRIGGER specialists_updated_at BEFORE UPDATE ON specialists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE knowledge_sources (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  specialist_id uuid NOT NULL,
  kind          text NOT NULL
                CHECK (kind IN ('public_document','org_document','internal_note')),
  title         text NOT NULL,
  insurer       text,
  product       text,
  susep_process text,
  origin        text NOT NULL DEFAULT 'upload'
                CHECK (origin IN ('upload','preloaded','written')),
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','inactive','archived')),
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT knowledge_sources_org_uk UNIQUE (org_id, id),
  FOREIGN KEY (org_id, specialist_id) REFERENCES specialists (org_id, id) ON DELETE CASCADE
);
CREATE INDEX ks_specialist_idx ON knowledge_sources (specialist_id, status)
  WHERE deleted_at IS NULL;

CREATE TABLE source_versions (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id          uuid NOT NULL,
  source_id       uuid NOT NULL,
  version_number  integer NOT NULL,
  file_key        text,
  file_name       text,
  checksum_sha256 text,
  page_count      integer,
  valid_from      date,
  valid_until     date,
  status          text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','processing','ready',
                                    'ready_with_warnings','failed','superseded')),
  warning_summary jsonb,
  is_current      boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sv_org_uk UNIQUE (org_id, id),
  CONSTRAINT sv_validity_chk
    CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from),
  FOREIGN KEY (org_id, source_id) REFERENCES knowledge_sources (org_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX sv_number_uk ON source_versions (source_id, version_number);
CREATE UNIQUE INDEX sv_current_uk ON source_versions (source_id) WHERE is_current;
CREATE UNIQUE INDEX sv_checksum_uk ON source_versions (org_id, checksum_sha256)
  WHERE checksum_sha256 IS NOT NULL;

CREATE TABLE chunks (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  specialist_id     uuid NOT NULL,
  source_version_id uuid NOT NULL,
  ordinal           integer NOT NULL,
  clause_path       text,
  clause_title      text,
  section_kind      text CHECK (section_kind IN
                    ('coverage','exclusion','waiting_period','definition',
                     'procedure','general','table')),
  page_start        integer,
  page_end          integer,
  content           text NOT NULL,
  content_tsv       tsvector GENERATED ALWAYS AS (
                      to_tsvector('pt_unaccent',
                        coalesce(clause_title,'') || ' ' || content)) STORED,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chunks_org_uk UNIQUE (org_id, id),
  FOREIGN KEY (org_id, source_version_id) REFERENCES source_versions (org_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX chunks_version_ordinal_uk ON chunks (source_version_id, ordinal);
CREATE INDEX chunks_tsv_idx ON chunks USING gin (content_tsv);
CREATE INDEX chunks_scope_idx ON chunks (org_id, specialist_id);
CREATE INDEX chunks_section_idx ON chunks (org_id, specialist_id, section_kind)
  WHERE section_kind IN ('exclusion','waiting_period');

-- Tabela separada: permite N modelos simultâneos durante migração de
-- embeddings, com índice HNSW parcial por modelo (e, agora, por org).
CREATE TABLE chunk_embeddings (
  chunk_id      uuid NOT NULL,
  org_id        uuid NOT NULL,
  specialist_id uuid NOT NULL,
  model         text NOT NULL,
  dimensions    smallint NOT NULL,
  embedding     vector(384) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, model),
  FOREIGN KEY (org_id, chunk_id) REFERENCES chunks (org_id, id) ON DELETE CASCADE
);
CREATE INDEX chunk_emb_org_idx ON chunk_embeddings (org_id, model);

-- RLS
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['specialists','knowledge_sources','source_versions',
                           'chunks','chunk_embeddings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (org_id = (SELECT current_org()))
         WITH CHECK (org_id = (SELECT current_org()))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
    -- worker precisa escrever conhecimento; nada além disso
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO app_worker', t);
  END LOOP;
END $$;
