-- =====================================================================
-- tests/sql/isolation.sql — Apoia Seguro   @casos-esperados: 47
--
-- PARTE 1 (T1–T17): suíte herdada do Cláusula (Milestone 1), sem mudança
-- de lógica; só o TRUNCATE inclui as tabelas novas.
-- PARTE 2 (A01–A30): tabelas e papéis criados na Apoia Seguro
-- (0009–0013): catálogo, documentos, trechos, páginas, fila, conversas,
-- citações, feedback, lacunas, uso, e-mail, leads, plataforma.
--
-- Lição da rodada de setembro: a suíte já declarou sucesso com metade
-- dos casos. O executor (tests/run-sql.ts) exige o NÚMERO de casos.
-- =====================================================================
-- =====================================================================
-- isolation_test.sql
--
-- Critério de aceite nº 1 do Milestone 1.
-- Threat Model: R-01, R-02, R-03, R-04, R-11, R-26.
--
-- Roda em CI a cada commit. Qualquer FAIL bloqueia o merge.
-- Este é o único controle que, existindo sozinho, ainda pega a maioria
-- dos vazamentos cross-tenant.
-- =====================================================================

\set ON_ERROR_STOP off
\pset pager off

CREATE TEMP TABLE results (
  id serial, name text, expected text, actual text, passed boolean
);

GRANT ALL ON results TO PUBLIC;
GRANT ALL ON SEQUENCE results_id_seq TO PUBLIC;

CREATE OR REPLACE FUNCTION check_it(p_name text, p_expected text, p_actual text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO results (name, expected, actual, passed)
  VALUES (p_name, p_expected, p_actual, p_expected IS NOT DISTINCT FROM p_actual);
END $$;

-- ---------------------------------------------------------------------
-- Fixtures (papel privilegiado)
-- Limpeza primeiro: a suíte precisa ser idempotente para rodar em CI
-- e localmente sem banco novo a cada execução.
-- ---------------------------------------------------------------------
TRUNCATE email_outbox, leads, lead_rate_limits, usage_events, knowledge_gaps, feedback,
         message_citations, messages, conversations, ingestion_jobs, document_pages,
         chunk_embeddings, chunks, source_versions, knowledge_sources, products, insurers,
         specialists, org_vector_strategy, rate_limits, password_resets, platform_admins,
         audit_logs, notifications, sessions, invitations,
         memberships, organizations, users RESTART IDENTITY CASCADE;

DO $$
DECLARE org_a uuid; org_b uuid; user_a uuid; user_b uuid;
BEGIN
  INSERT INTO organizations (name, slug) VALUES ('Corretora A','corretora-a')
    RETURNING id INTO org_a;
  INSERT INTO organizations (name, slug) VALUES ('Corretora B','corretora-b')
    RETURNING id INTO org_b;

  INSERT INTO users (email, name) VALUES ('ricardo@a.com','Ricardo A')
    RETURNING id INTO user_a;
  INSERT INTO users (email, name) VALUES ('marina@b.com','Marina B')
    RETURNING id INTO user_b;

  INSERT INTO memberships (org_id, user_id, role) VALUES (org_a, user_a, 'owner');
  INSERT INTO memberships (org_id, user_id, role) VALUES (org_b, user_b, 'owner');

  INSERT INTO invitations (org_id, email, role, token_hash, invited_by, expires_at)
  VALUES (org_a,'novo@a.com','member','hash-a', user_a, now() + interval '7 days');
  INSERT INTO invitations (org_id, email, role, token_hash, invited_by, expires_at)
  VALUES (org_b,'novo@b.com','member','hash-b', user_b, now() + interval '7 days');

  INSERT INTO notifications (org_id, user_id, kind, title)
  VALUES (org_a, user_a, 'test', 'Notificação A');
  INSERT INTO notifications (org_id, user_id, kind, title)
  VALUES (org_b, user_b, 'test', 'Notificação B');

  INSERT INTO audit_logs (org_id, actor_id, action, entity_type)
  VALUES (org_a, user_a, 'org.created', 'organization');
  INSERT INTO audit_logs (org_id, actor_id, action, entity_type)
  VALUES (org_b, user_b, 'org.created', 'organization');

  INSERT INTO sessions (user_id, token_hash, active_org_id, expires_at)
  VALUES (user_a, 'sess-a', org_a, now() + interval '1 day');
  INSERT INTO sessions (user_id, token_hash, active_org_id, expires_at)
  VALUES (user_b, 'sess-b', org_b, now() + interval '1 day');

  CREATE TEMP TABLE fixtures AS
    SELECT org_a AS org_a, org_b AS org_b, user_a AS user_a, user_b AS user_b;
END $$;

-- =====================================================================
-- T1..T7 — leitura com contexto da org A não alcança dados da org B
-- =====================================================================
DO $$
DECLARE f record; n int;
BEGIN
  SELECT * INTO f FROM fixtures;
  SET LOCAL ROLE app_user;
  PERFORM set_config('app.current_org', f.org_a::text, true);
  PERFORM set_config('app.current_user', f.user_a::text, true);

  SELECT count(*) INTO n FROM organizations WHERE id = f.org_b;
  PERFORM check_it('T1 organizations: A não lê B', '0', n::text);

  SELECT count(*) INTO n FROM memberships WHERE org_id = f.org_b;
  PERFORM check_it('T2 memberships: A não lê B', '0', n::text);

  SELECT count(*) INTO n FROM invitations WHERE org_id = f.org_b;
  PERFORM check_it('T3 invitations: A não lê B', '0', n::text);

  SELECT count(*) INTO n FROM notifications WHERE org_id = f.org_b;
  PERFORM check_it('T4 notifications: A não lê B', '0', n::text);

  SELECT count(*) INTO n FROM audit_logs WHERE org_id = f.org_b;
  PERFORM check_it('T5 audit_logs: A não lê B', '0', n::text);

  SELECT count(*) INTO n FROM users WHERE id = f.user_b;
  PERFORM check_it('T6 users: A não enxerga usuário de B', '0', n::text);

  SELECT count(*) INTO n FROM sessions WHERE user_id = f.user_b;
  PERFORM check_it('T7 sessions: A não lê sessão de B', '0', n::text);

  -- controle positivo: sem isto, um bug que zera tudo passaria nos testes
  SELECT count(*) INTO n FROM memberships WHERE org_id = f.org_a;
  PERFORM check_it('T8 controle positivo: A lê os próprios dados', '1', n::text);

  RESET ROLE;
END $$;

-- =====================================================================
-- T9..T11 — escrita cravando org alheia é bloqueada (WITH CHECK)
-- =====================================================================
DO $$
DECLARE f record; ok text;
BEGIN
  SELECT * INTO f FROM fixtures;
  SET LOCAL ROLE app_user;
  PERFORM set_config('app.current_org', f.org_a::text, true);
  PERFORM set_config('app.current_user', f.user_a::text, true);

  BEGIN
    INSERT INTO notifications (org_id, user_id, kind, title)
    VALUES (f.org_b, f.user_b, 'evil', 'injetada');
    ok := 'PERMITIU';
  EXCEPTION WHEN insufficient_privilege OR others THEN
    ok := 'BLOQUEADO';
  END;
  PERFORM check_it('T9 INSERT com org_id alheio', 'BLOQUEADO', ok);

  BEGIN
    INSERT INTO memberships (org_id, user_id, role)
    VALUES (f.org_b, f.user_a, 'owner');
    ok := 'PERMITIU';
  EXCEPTION WHEN others THEN ok := 'BLOQUEADO';
  END;
  PERFORM check_it('T10 auto-inserção em org alheia', 'BLOQUEADO', ok);

  BEGIN
    UPDATE organizations SET name = 'invadida' WHERE id = f.org_b;
    IF FOUND THEN ok := 'PERMITIU'; ELSE ok := 'BLOQUEADO'; END IF;
  EXCEPTION WHEN others THEN ok := 'BLOQUEADO';
  END;
  PERFORM check_it('T11 UPDATE em org alheia', 'BLOQUEADO', ok);

  RESET ROLE;
END $$;

-- =====================================================================
-- T12 — falha fechada: sem contexto de tenant, nada passa
-- =====================================================================
DO $$
DECLARE ok text;
BEGIN
  SET LOCAL ROLE app_user;
  PERFORM set_config('app.current_org', '', true);
  BEGIN
    PERFORM count(*) FROM memberships;
    ok := 'PERMITIU';
  EXCEPTION WHEN others THEN ok := 'BLOQUEADO';
  END;
  PERFORM check_it('T12 sem contexto de tenant', 'BLOQUEADO', ok);
  RESET ROLE;
END $$;

-- =====================================================================
-- T13..T14 — auditoria é append-only no banco
-- =====================================================================
DO $$
DECLARE f record; ok text;
BEGIN
  SELECT * INTO f FROM fixtures;
  SET LOCAL ROLE app_user;
  PERFORM set_config('app.current_org', f.org_a::text, true);

  BEGIN
    UPDATE audit_logs SET action = 'apagado' WHERE org_id = f.org_a;
    ok := 'PERMITIU';
  EXCEPTION WHEN others THEN ok := 'BLOQUEADO';
  END;
  PERFORM check_it('T13 UPDATE em audit_logs', 'BLOQUEADO', ok);

  BEGIN
    DELETE FROM audit_logs WHERE org_id = f.org_a;
    ok := 'PERMITIU';
  EXCEPTION WHEN others THEN ok := 'BLOQUEADO';
  END;
  PERFORM check_it('T14 DELETE em audit_logs', 'BLOQUEADO', ok);

  RESET ROLE;
END $$;

-- =====================================================================
-- T15..T16 — worker roda SEM RLS: escopo mínimo é a única defesa
-- =====================================================================
DO $$
DECLARE f record; ok text;
BEGIN
  SELECT * INTO f FROM fixtures;
  SET LOCAL ROLE app_worker;

  BEGIN
    PERFORM count(*) FROM users;
    ok := 'PERMITIU';
  EXCEPTION WHEN insufficient_privilege THEN ok := 'BLOQUEADO';
  END;
  PERFORM check_it('T15 worker não acessa users', 'BLOQUEADO', ok);

  BEGIN
    PERFORM count(*) FROM sessions;
    ok := 'PERMITIU';
  EXCEPTION WHEN insufficient_privilege THEN ok := 'BLOQUEADO';
  END;
  PERFORM check_it('T16 worker não acessa sessions', 'BLOQUEADO', ok);

  RESET ROLE;
END $$;

-- =====================================================================
-- T17 — invariante estrutural: toda tabela com org_id tem RLS + FORCE
-- Pega a regressão mais provável do projeto: tabela nova sem policy.
-- =====================================================================
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r','p')
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND a.attnum > 0
    )
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity);

  PERFORM check_it('T17 toda tabela com org_id tem RLS+FORCE',
                   '(nenhuma)', coalesce(missing, '(nenhuma)'));
END $$;


-- =====================================================================
-- PARTE 2 — Apoia Seguro
-- Fixtures de conhecimento e conversa nas duas corretoras + um segundo
-- usuário (corretor) na corretora A para testar visibilidade interna.
-- =====================================================================
DO $$
DECLARE f record; spec_a uuid; spec_b uuid; ins_a uuid; ins_b uuid; prod_a uuid; prod_b uuid;
        src_a uuid; src_b uuid; ver_a uuid; ver_b uuid; ch_a uuid; ch_b uuid;
        conv_a uuid; conv_b uuid; msg_a uuid; msg_b uuid; corretor_a uuid;
BEGIN
  SELECT * INTO f FROM fixtures;
  INSERT INTO users (email, name) VALUES ('corretor@a.com','Corretor A') RETURNING id INTO corretor_a;
  INSERT INTO memberships (org_id, user_id, role) VALUES (f.org_a, corretor_a, 'member');

  INSERT INTO specialists (org_id, name, branch, created_by) VALUES (f.org_a,'Assistente A','geral',f.user_a) RETURNING id INTO spec_a;
  INSERT INTO specialists (org_id, name, branch, created_by) VALUES (f.org_b,'Assistente B','geral',f.user_b) RETURNING id INTO spec_b;
  INSERT INTO insurers (org_id, name) VALUES (f.org_a,'Seguradora A') RETURNING id INTO ins_a;
  INSERT INTO insurers (org_id, name) VALUES (f.org_b,'Seguradora B') RETURNING id INTO ins_b;
  INSERT INTO products (org_id, insurer_id, name) VALUES (f.org_a, ins_a, 'Produto A') RETURNING id INTO prod_a;
  INSERT INTO products (org_id, insurer_id, name) VALUES (f.org_b, ins_b, 'Produto B') RETURNING id INTO prod_b;
  INSERT INTO knowledge_sources (org_id, specialist_id, kind, title, insurer_id) VALUES (f.org_a, spec_a,'org_document','Doc A', ins_a) RETURNING id INTO src_a;
  INSERT INTO knowledge_sources (org_id, specialist_id, kind, title, insurer_id) VALUES (f.org_b, spec_b,'org_document','Doc B', ins_b) RETURNING id INTO src_b;
  INSERT INTO source_versions (org_id, source_id, version_number, status, file_key) VALUES (f.org_a, src_a, 1, 'ready', 'a') RETURNING id INTO ver_a;
  INSERT INTO source_versions (org_id, source_id, version_number, status, file_key) VALUES (f.org_b, src_b, 1, 'ready', 'b') RETURNING id INTO ver_b;
  INSERT INTO chunks (org_id, specialist_id, source_version_id, ordinal, content) VALUES (f.org_a, spec_a, ver_a, 1, 'cobertura de incêndio da corretora A') RETURNING id INTO ch_a;
  INSERT INTO chunks (org_id, specialist_id, source_version_id, ordinal, content) VALUES (f.org_b, spec_b, ver_b, 1, 'cobertura de incêndio da corretora B segredo') RETURNING id INTO ch_b;
  INSERT INTO document_pages (org_id, source_version_id, page_number, content) VALUES (f.org_a, ver_a, 1, 'página A');
  INSERT INTO document_pages (org_id, source_version_id, page_number, content) VALUES (f.org_b, ver_b, 1, 'página B');
  INSERT INTO ingestion_jobs (org_id, source_version_id, status) VALUES (f.org_a, ver_a, 'done');
  INSERT INTO ingestion_jobs (org_id, source_version_id, status) VALUES (f.org_b, ver_b, 'queued');
  INSERT INTO conversations (org_id, user_id, specialist_id, title) VALUES (f.org_a, f.user_a, spec_a, 'Conversa do dono A') RETURNING id INTO conv_a;
  INSERT INTO conversations (org_id, user_id, specialist_id, title) VALUES (f.org_b, f.user_b, spec_b, 'Conversa B') RETURNING id INTO conv_b;
  INSERT INTO messages (org_id, conversation_id, user_id, question, status, confidence, summary, mode)
    VALUES (f.org_a, conv_a, f.user_a, 'pergunta A', 'answered', 'strong', 'resposta A', 'extractive') RETURNING id INTO msg_a;
  INSERT INTO messages (org_id, conversation_id, user_id, question, status, confidence, summary, mode)
    VALUES (f.org_b, conv_b, f.user_b, 'pergunta B', 'answered', 'strong', 'resposta B', 'extractive') RETURNING id INTO msg_b;
  INSERT INTO message_citations (org_id, message_id, ordinal, source_title, quote) VALUES (f.org_a, msg_a, 1, 'Doc A', 'trecho A');
  INSERT INTO message_citations (org_id, message_id, ordinal, source_title, quote) VALUES (f.org_b, msg_b, 1, 'Doc B', 'trecho B');
  INSERT INTO feedback (org_id, message_id, user_id, rating) VALUES (f.org_a, msg_a, f.user_a, 'useful');
  INSERT INTO feedback (org_id, message_id, user_id, rating) VALUES (f.org_b, msg_b, f.user_b, 'wrong');
  INSERT INTO knowledge_gaps (org_id, question, normalized) VALUES (f.org_a, 'lacuna A', 'lacuna a');
  INSERT INTO knowledge_gaps (org_id, question, normalized) VALUES (f.org_b, 'lacuna B', 'lacuna b');
  INSERT INTO usage_events (org_id, kind) VALUES (f.org_a, 'consulta'), (f.org_b, 'consulta');
  INSERT INTO email_outbox (org_id, to_email, kind, subject, body_text, body_html) VALUES (f.org_b, 'x@b.com', 'invitation', 's', 'link secreto B', 'h');
  INSERT INTO leads (name, email, consent_at, consent_version) VALUES ('Lead', 'lead@x.com', now(), 'v1');
  INSERT INTO platform_admins (user_id) VALUES (f.user_b);
  INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (f.user_b, 'reset-b', now() + interval '1 hour');
  INSERT INTO notifications (org_id, user_id, kind, title) VALUES (f.org_a, corretor_a, 'test', 'Notificação do corretor A');

  CREATE TEMP TABLE fixtures2 AS SELECT ver_b, ch_b, conv_a, msg_a, conv_b, corretor_a, ver_a;
  GRANT SELECT ON fixtures, fixtures2 TO PUBLIC;
END $$;

-- A01–A14: leitura com contexto da corretora A não alcança B em nenhuma tabela nova
DO $$
DECLARE f record; n int;
BEGIN
  SELECT * INTO f FROM fixtures;
  SET LOCAL ROLE app_user;
  PERFORM set_config('app.current_org', f.org_a::text, true);
  PERFORM set_config('app.current_user', f.user_a::text, true);

  SELECT count(*) INTO n FROM insurers WHERE org_id = f.org_b;           PERFORM check_it('A01 insurers: A não lê B', '0', n::text);
  SELECT count(*) INTO n FROM products WHERE org_id = f.org_b;           PERFORM check_it('A02 products: A não lê B', '0', n::text);
  SELECT count(*) INTO n FROM knowledge_sources WHERE org_id = f.org_b;  PERFORM check_it('A03 knowledge_sources: A não lê B', '0', n::text);
  SELECT count(*) INTO n FROM source_versions WHERE org_id = f.org_b;    PERFORM check_it('A04 source_versions: A não lê B', '0', n::text);
  SELECT count(*) INTO n FROM chunks WHERE content ILIKE '%segredo%';    PERFORM check_it('A05 chunks: A não acha texto de B', '0', n::text);
  SELECT count(*) INTO n FROM document_pages WHERE org_id = f.org_b;     PERFORM check_it('A06 document_pages: A não lê B', '0', n::text);
  SELECT count(*) INTO n FROM ingestion_jobs WHERE org_id = f.org_b;     PERFORM check_it('A07 ingestion_jobs: A não lê B', '0', n::text);
  SELECT count(*) INTO n FROM conversations WHERE org_id = f.org_b;      PERFORM check_it('A08 conversations: A não lê B', '0', n::text);
  SELECT count(*) INTO n FROM messages WHERE org_id = f.org_b;           PERFORM check_it('A09 messages: A não lê B', '0', n::text);
  SELECT count(*) INTO n FROM message_citations WHERE org_id = f.org_b;  PERFORM check_it('A10 message_citations: A não lê B', '0', n::text);
  SELECT count(*) INTO n FROM feedback WHERE org_id = f.org_b;           PERFORM check_it('A11 feedback: A não lê B', '0', n::text);
  SELECT count(*) INTO n FROM knowledge_gaps WHERE org_id = f.org_b;     PERFORM check_it('A12 knowledge_gaps: A não lê B', '0', n::text);
  SELECT count(*) INTO n FROM usage_events WHERE org_id = f.org_b;       PERFORM check_it('A13 usage_events: A não lê B', '0', n::text);
  -- controle positivo
  SELECT count(*) INTO n FROM chunks;                                    PERFORM check_it('A14 controle positivo: A lê o próprio trecho', '1', n::text);
  RESET ROLE;
END $$;

-- A15–A18: escrita cravando org alheia
DO $$
DECLARE f record; f2 record; ok text;
BEGIN
  SELECT * INTO f FROM fixtures; SELECT * INTO f2 FROM fixtures2;
  SET LOCAL ROLE app_user;
  PERFORM set_config('app.current_org', f.org_a::text, true);
  PERFORM set_config('app.current_user', f.user_a::text, true);

  BEGIN INSERT INTO insurers (org_id, name) VALUES (f.org_b, 'invasora'); ok := 'PERMITIU';
  EXCEPTION WHEN others THEN ok := 'BLOQUEADO'; END;
  PERFORM check_it('A15 INSERT de seguradora em org alheia', 'BLOQUEADO', ok);

  BEGIN INSERT INTO ingestion_jobs (org_id, source_version_id) VALUES (f.org_b, f2.ver_b); ok := 'PERMITIU';
  EXCEPTION WHEN others THEN ok := 'BLOQUEADO'; END;
  PERFORM check_it('A16 enfileirar processamento de documento alheio', 'BLOQUEADO', ok);

  BEGIN INSERT INTO messages (org_id, conversation_id, user_id, question, status, confidence, summary, mode)
        VALUES (f.org_a, f2.conv_a, f2.corretor_a, 'falsificada', 'answered', 'strong', 'x', 'extractive'); ok := 'PERMITIU';
  EXCEPTION WHEN others THEN ok := 'BLOQUEADO'; END;
  PERFORM check_it('A17 gravar mensagem em nome de outra pessoa', 'BLOQUEADO', ok);

  BEGIN UPDATE source_versions SET status = 'failed' WHERE id = f2.ver_b;
        IF FOUND THEN ok := 'PERMITIU'; ELSE ok := 'BLOQUEADO'; END IF;
  EXCEPTION WHEN others THEN ok := 'BLOQUEADO'; END;
  PERFORM check_it('A18 alterar versão de documento alheia', 'BLOQUEADO', ok);
  RESET ROLE;
END $$;

-- A19–A21: visibilidade interna da corretora A (corretor x administração)
DO $$
DECLARE f record; f2 record; n int;
BEGIN
  SELECT * INTO f FROM fixtures; SELECT * INTO f2 FROM fixtures2;
  SET LOCAL ROLE app_user;
  PERFORM set_config('app.current_org', f.org_a::text, true);
  PERFORM set_config('app.current_user', f2.corretor_a::text, true);
  SELECT count(*) INTO n FROM conversations WHERE id = f2.conv_a;      PERFORM check_it('A19 corretor não lê conversa do colega', '0', n::text);
  SELECT count(*) INTO n FROM message_citations;                       PERFORM check_it('A20 corretor não lê citações do colega', '0', n::text);
  SELECT count(*) INTO n FROM notifications;                           PERFORM check_it('A21 corretor lê só a própria notificação', '1', n::text);
  RESET ROLE;
END $$;

-- A22–A25: tabelas sem acesso para a aplicação
DO $$
DECLARE f record; ok text;
BEGIN
  SELECT * INTO f FROM fixtures;
  SET LOCAL ROLE app_user;
  PERFORM set_config('app.current_org', f.org_a::text, true);
  PERFORM set_config('app.current_user', f.user_a::text, true);
  BEGIN PERFORM count(*) FROM email_outbox; ok := 'PERMITIU'; EXCEPTION WHEN insufficient_privilege THEN ok := 'BLOQUEADO'; END;
  PERFORM check_it('A22 aplicação não lê caixa de e-mail (links de convite)', 'BLOQUEADO', ok);
  BEGIN PERFORM count(*) FROM leads; ok := 'PERMITIU'; EXCEPTION WHEN insufficient_privilege THEN ok := 'BLOQUEADO'; END;
  PERFORM check_it('A23 aplicação da corretora não lê leads', 'BLOQUEADO', ok);
  BEGIN PERFORM count(*) FROM password_resets; ok := 'PERMITIU'; EXCEPTION WHEN insufficient_privilege THEN ok := 'BLOQUEADO'; END;
  PERFORM check_it('A24 aplicação não lê links de senha', 'BLOQUEADO', ok);
  BEGIN PERFORM * FROM claim_ingestion_job(); ok := 'PERMITIU'; EXCEPTION WHEN insufficient_privilege THEN ok := 'BLOQUEADO'; END;
  PERFORM check_it('A25 aplicação não reserva trabalho da fila global', 'BLOQUEADO', ok);
  RESET ROLE;
END $$;

-- A26–A28: papel público e de plataforma
DO $$
DECLARE ok text; n int;
BEGIN
  SET LOCAL ROLE app_public;
  BEGIN PERFORM count(*) FROM leads; ok := 'PERMITIU'; EXCEPTION WHEN insufficient_privilege THEN ok := 'BLOQUEADO'; END;
  PERFORM check_it('A26 formulário público não lê leads', 'BLOQUEADO', ok);
  BEGIN PERFORM count(*) FROM organizations; ok := 'PERMITIU'; EXCEPTION WHEN insufficient_privilege THEN ok := 'BLOQUEADO'; END;
  PERFORM check_it('A27 formulário público não lê corretoras', 'BLOQUEADO', ok);
  RESET ROLE;

  SET LOCAL ROLE app_platform;
  BEGIN PERFORM count(*) FROM chunks; ok := 'PERMITIU'; EXCEPTION WHEN insufficient_privilege THEN ok := 'BLOQUEADO'; END;
  PERFORM check_it('A28 plataforma não lê conteúdo de documentos', 'BLOQUEADO', ok);
  RESET ROLE;
END $$;

-- A29–A30: worker com contexto de UMA corretora só vê aquela
DO $$
DECLARE f record; n int; ok text;
BEGIN
  SELECT * INTO f FROM fixtures;
  SET LOCAL ROLE app_worker;
  PERFORM set_config('app.current_org', f.org_a::text, true);
  SELECT count(*) INTO n FROM chunks WHERE content ILIKE '%segredo%';
  PERFORM check_it('A29 worker no contexto de A não lê trecho de B', '0', n::text);
  BEGIN PERFORM count(*) FROM conversations; ok := 'PERMITIU'; EXCEPTION WHEN insufficient_privilege THEN ok := 'BLOQUEADO'; END;
  PERFORM check_it('A30 worker não lê conversas', 'BLOQUEADO', ok);
  RESET ROLE;
END $$;

-- =====================================================================
-- Relatório
-- =====================================================================
SELECT
  CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS status,
  name, expected, actual
FROM results ORDER BY id;

SELECT
  count(*) FILTER (WHERE passed)       AS passou,
  count(*) FILTER (WHERE NOT passed)   AS falhou,
  CASE WHEN count(*) FILTER (WHERE NOT passed) = 0
       THEN 'ISOLAMENTO: OK' ELSE 'ISOLAMENTO: FALHOU' END AS resultado
FROM results;
