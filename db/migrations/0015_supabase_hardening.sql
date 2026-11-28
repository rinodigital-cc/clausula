-- Hardening aplicado na homologação em 2026-11-06.
-- Idempotente: fixa search_path de funções expostas e reduz superfície do Data API.
-- Em Supabase, anon/authenticated existem. Em Postgres local/CI podem não existir;
-- nesse caso o bloco condicional apenas ignora os REVOKEs específicos desses roles.

ALTER FUNCTION public.uuidv7() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.current_org() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.current_actor() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.create_audit_partition(date) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.consume_rate_limit(text, integer, interval) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.vector_strategy_threshold() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.refresh_vector_strategy(uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.vector_health_check(integer) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.current_org_role() SET search_path = public, extensions, pg_temp;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;
