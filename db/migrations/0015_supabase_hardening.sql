-- Hardening aplicado na homologação em 2026-11-06.
-- Idempotente: fixa search_path de funções expostas e reduz superfície do Data API.
-- A aplicação usa os papéis apoia_* via conexões PostgreSQL próprias; anon/authenticated
-- não precisam de privilégios diretos sobre as tabelas de negócio.

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

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
