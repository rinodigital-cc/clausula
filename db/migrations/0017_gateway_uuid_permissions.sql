-- Permissões mínimas para funções UUID usadas pelas roles remotas do DB Gateway.
-- O schema extensions existe no Supabase hospedado, mas não no Postgres local do CI.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    GRANT USAGE ON SCHEMA extensions TO app_bootstrap;
    GRANT USAGE ON SCHEMA extensions TO app_platform;

    IF to_regprocedure('extensions.gen_random_bytes(integer)') IS NOT NULL THEN
      GRANT EXECUTE ON FUNCTION extensions.gen_random_bytes(integer) TO app_bootstrap;
      GRANT EXECUTE ON FUNCTION extensions.gen_random_bytes(integer) TO app_platform;
    END IF;
  END IF;
END
$$;
