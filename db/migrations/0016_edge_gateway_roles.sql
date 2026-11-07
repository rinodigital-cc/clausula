-- Edge Functions do Supabase conectam usando o usuário postgres interno.
-- Membership permite SET LOCAL ROLE para preservar os mesmos papéis/RLS da aplicação
-- quando o acesso é mediado pelo db-gateway autenticado por Vercel OIDC.
GRANT app_user TO postgres;
GRANT app_bootstrap TO postgres;
GRANT app_platform TO postgres;
GRANT app_worker TO postgres;
GRANT app_public TO postgres;
