-- Permissões mínimas para funções UUID usadas pelas roles remotas do DB Gateway.
GRANT USAGE ON SCHEMA extensions TO app_bootstrap;
GRANT EXECUTE ON FUNCTION extensions.gen_random_bytes(integer) TO app_bootstrap;

GRANT USAGE ON SCHEMA extensions TO app_platform;
GRANT EXECUTE ON FUNCTION extensions.gen_random_bytes(integer) TO app_platform;
