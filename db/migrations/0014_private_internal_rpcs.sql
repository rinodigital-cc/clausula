-- Supabase may grant API roles EXECUTE explicitly, even after REVOKE FROM PUBLIC.
-- Preserve internal application roles and do not expose worker/quota RPCs.
REVOKE EXECUTE ON FUNCTION public.claim_ingestion_job() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_lead_quota(text, integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.claim_ingestion_job() FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.consume_lead_quota(text, integer) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.claim_ingestion_job() FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.consume_lead_quota(text, integer) FROM authenticated';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.claim_ingestion_job() TO app_worker;
GRANT EXECUTE ON FUNCTION public.consume_lead_quota(text, integer) TO app_public;
