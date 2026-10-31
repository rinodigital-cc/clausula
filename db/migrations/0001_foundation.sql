-- =====================================================================
-- 0001_foundation.sql
-- Extensões, utilitários, papéis de banco e contrato de contexto de tenant.
--
-- Executado com papel de MIGRAÇÃO (owner do schema), nunca com o papel
-- da aplicação.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------
-- uuidv7
-- PostgreSQL 18 traz uuidv7() nativo. Em 16/17 precisamos da nossa.
-- Ordenada no tempo: evita a fragmentação de índice que o uuid v4 causa.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid
LANGUAGE plpgsql VOLATILE PARALLEL SAFE AS $$
DECLARE
  unix_ms bigint;
  uuid_bytes bytea;
BEGIN
  unix_ms := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  uuid_bytes := gen_random_bytes(16);

  -- 48 bits de timestamp em milissegundos
  uuid_bytes := set_byte(uuid_bytes, 0, ((unix_ms >> 40) & 255)::int);
  uuid_bytes := set_byte(uuid_bytes, 1, ((unix_ms >> 32) & 255)::int);
  uuid_bytes := set_byte(uuid_bytes, 2, ((unix_ms >> 24) & 255)::int);
  uuid_bytes := set_byte(uuid_bytes, 3, ((unix_ms >> 16) & 255)::int);
  uuid_bytes := set_byte(uuid_bytes, 4, ((unix_ms >>  8) & 255)::int);
  uuid_bytes := set_byte(uuid_bytes, 5, ( unix_ms        & 255)::int);

  -- versão 7 no nibble alto do byte 6
  uuid_bytes := set_byte(uuid_bytes, 6,
                  ((get_byte(uuid_bytes, 6) & 15) | 112));
  -- variante RFC 4122 nos dois bits altos do byte 8
  uuid_bytes := set_byte(uuid_bytes, 8,
                  ((get_byte(uuid_bytes, 8) & 63) | 128));

  RETURN encode(uuid_bytes, 'hex')::uuid;
END $$;

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- Contexto de tenant
--
-- current_org() é STABLE e usada dentro das policies via subconsulta
-- — (SELECT current_org()) — para ser avaliada UMA vez por query e não
-- uma vez por linha. Sem isso, uma varredura de 600k chunks chamaria a
-- função 600k vezes.
--
-- Lança exceção quando não definida: falha fechada. Uma query sem
-- contexto de tenant é um bug, não uma consulta global silenciosa.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_org() RETURNS uuid
LANGUAGE plpgsql STABLE PARALLEL SAFE AS $$
DECLARE v text;
BEGIN
  v := current_setting('app.current_org', true);
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'app.current_org não definido: contexto de tenant ausente'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v::uuid;
END $$;

CREATE OR REPLACE FUNCTION current_actor() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.current_user', true), '')::uuid
$$;

-- ---------------------------------------------------------------------
-- Papéis (Threat Model R-07: privilégio mínimo por processo)
--
--   app_user    → aplicação web. RLS SEMPRE aplicada.
--   app_worker  → worker de ingestão. Roda sem RLS por necessidade
--                 operacional, e por isso recebe o MENOR escopo de
--                 tabelas possível. É a fronteira F5 do threat model.
--   app_migrator→ dono do schema. Nunca usado em runtime.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_user, app_worker;
