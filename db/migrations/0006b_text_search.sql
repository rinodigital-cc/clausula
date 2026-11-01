-- =====================================================================
-- 0006b_text_search.sql  (Apoia Seguro, out/2026)
--
-- ACHADO NA AUDITORIA DO LEGADO: a 0007 usa a configuração de busca
-- 'pt_unaccent' na coluna gerada de chunks, mas nenhuma migração do
-- pacote recuperado a criava. Rodando 0001→0008 do zero, a 0007 falha.
--
-- Nome com sufixo "b" para entrar ENTRE a 0006 e a 0007 sem renumerar
-- nem editar migrações herdadas.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'pt_unaccent') THEN
    CREATE TEXT SEARCH CONFIGURATION pt_unaccent (COPY = portuguese);
    ALTER TEXT SEARCH CONFIGURATION pt_unaccent
      ALTER MAPPING FOR hword, hword_part, word
      WITH unaccent, portuguese_stem;
  END IF;
END $$;
