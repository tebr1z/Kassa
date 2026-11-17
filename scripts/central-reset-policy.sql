-- Run ONLY as the trusted central PostgreSQL operator, never as the application.
-- Before loading this file, explicitly configure the restricted application role:
--   SELECT pg_catalog.set_config('restamarket.application_role','restamarket_app',false);
-- After loading it, initialize the ONE master user explicitly (no auto-selection):
--   SELECT restamarket_control.initialize_sales_reset_policy('MASTER-USER-UUID'::uuid);
-- Re-running with the same master preserves usage. A different master is rejected.
-- Keep this schema out of application snapshots/imports. Do not grant its ownership,
-- table writes or initialize function to the application or the website role.

BEGIN;

DO $guard$
DECLARE
  app_role name := NULLIF(pg_catalog.current_setting('restamarket.application_role',true),'');
  role_record record;
  schema_owner name;
BEGIN
  IF app_role IS NULL THEN
    RAISE EXCEPTION 'Set restamarket.application_role to the restricted application role first';
  END IF;
  SELECT r.oid,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,r.rolinherit
    INTO role_record FROM pg_catalog.pg_roles r WHERE r.rolname=app_role;
  IF NOT FOUND OR app_role=current_user OR role_record.rolsuper OR role_record.rolcreatedb
     OR role_record.rolcreaterole OR role_record.rolreplication OR role_record.rolbypassrls OR role_record.rolinherit
     OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=role_record.oid)
     OR pg_catalog.pg_has_role(app_role,current_user,'MEMBER') THEN
    RAISE EXCEPTION 'The reset application role must be NOINHERIT, unprivileged, and have no role memberships';
  END IF;
  SELECT pg_catalog.pg_get_userbyid(n.nspowner) INTO schema_owner
    FROM pg_catalog.pg_namespace n WHERE n.nspname='restamarket_control';
  IF schema_owner IS NOT NULL AND schema_owner<>current_user THEN
    RAISE EXCEPTION 'The control schema must be owned by the trusted operator running this script';
  END IF;
END
$guard$;

CREATE SCHEMA IF NOT EXISTS restamarket_control;
REVOKE ALL ON SCHEMA restamarket_control FROM PUBLIC;

CREATE TABLE IF NOT EXISTS restamarket_control.sales_reset_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  master_user_id uuid NOT NULL,
  reset_limit smallint NOT NULL DEFAULT 3 CHECK (reset_limit=3),
  used_count smallint NOT NULL DEFAULT 0 CHECK (used_count BETWEEN 0 AND 3),
  initialized_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  exhausted_at timestamptz,
  CHECK ((used_count=3)=(exhausted_at IS NOT NULL))
);

-- No FK to public.users/audit_logs: application-only snapshot restores may replace
-- those tables, but must never delete the lifetime limit or its independent ledger.
CREATE TABLE IF NOT EXISTS restamarket_control.sales_reset_ledger (
  reset_id uuid PRIMARY KEY,
  ordinal smallint NOT NULL UNIQUE CHECK (ordinal BETWEEN 1 AND 3),
  actor_user_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (pg_catalog.char_length(reason) BETWEEN 3 AND 500),
  backup jsonb,
  consumed_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  legacy boolean NOT NULL DEFAULT false
);

CREATE OR REPLACE FUNCTION restamarket_control.read_sales_reset_policy(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $function$
DECLARE
  policy restamarket_control.sales_reset_policy%ROWTYPE;
  ledger_count integer;
  ledger_max integer;
BEGIN
  SELECT p.* INTO policy FROM restamarket_control.sales_reset_policy p WHERE p.singleton;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='RM001',MESSAGE='RESET_POLICY_NOT_CONFIGURED';
  END IF;
  SELECT pg_catalog.count(*)::integer,COALESCE(pg_catalog.max(l.ordinal),0)::integer
    INTO ledger_count,ledger_max FROM restamarket_control.sales_reset_ledger l;
  IF policy.reset_limit<>3 OR policy.used_count<0 OR policy.used_count>3
     OR ledger_count<>policy.used_count OR ledger_max<>policy.used_count
     OR (policy.used_count=3)<>(policy.exhausted_at IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='RM004',MESSAGE='RESET_POLICY_INVALID';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=p_actor AND u.role='admin' AND u.is_active=true AND u.password_hash IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='RM002',MESSAGE='MASTER_REQUIRED';
  END IF;
  RETURN pg_catalog.jsonb_build_object('master',policy.master_user_id=p_actor,
    'used',policy.used_count,'remaining',3-policy.used_count,'limit',3,'exhausted',policy.used_count=3);
END
$function$;

CREATE OR REPLACE FUNCTION restamarket_control.consume_sales_reset(
  p_actor uuid,p_reset_id uuid,p_started_at timestamptz,p_reason text,p_backup jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $function$
DECLARE
  policy restamarket_control.sales_reset_policy%ROWTYPE;
  state jsonb;
BEGIN
  SELECT p.* INTO policy FROM restamarket_control.sales_reset_policy p WHERE p.singleton FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='RM001',MESSAGE='RESET_POLICY_NOT_CONFIGURED';
  END IF;
  -- The read function checks active admin status and ledger consistency as well.
  state:=restamarket_control.read_sales_reset_policy(p_actor);
  IF policy.master_user_id<>p_actor THEN
    RAISE EXCEPTION USING ERRCODE='RM002',MESSAGE='MASTER_REQUIRED';
  END IF;
  PERFORM 1 FROM public.users u WHERE u.id=p_actor AND u.role='admin' AND u.is_active=true
    AND u.password_hash IS NOT NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='RM002',MESSAGE='MASTER_REQUIRED';
  END IF;
  IF policy.used_count>=3 THEN
    RAISE EXCEPTION USING ERRCODE='RM003',MESSAGE='RESET_LIMIT_EXHAUSTED';
  END IF;
  IF p_reset_id IS NULL OR p_started_at IS NULL OR p_reason IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_reason)) NOT BETWEEN 3 AND 500
     OR p_reason ~ '[[:cntrl:]]' OR p_backup IS NULL OR pg_catalog.jsonb_typeof(p_backup)<>'object'
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_backup))<>3
     OR NOT (p_backup ?& ARRAY['fileName','sha256','bytes'])
     OR pg_catalog.jsonb_typeof(p_backup->'fileName')<>'string'
     OR pg_catalog.char_length(p_backup->>'fileName') NOT BETWEEN 10 AND 189
     OR (p_backup->>'fileName') !~* '\.birkassa$'
     OR (p_backup->>'fileName') ~ '[/\\:*?"<>|[:cntrl:]]'
     OR pg_catalog.jsonb_typeof(p_backup->'sha256')<>'string'
     OR (p_backup->>'sha256') !~ '^[a-f0-9]{64}$'
     OR pg_catalog.jsonb_typeof(p_backup->'bytes')<>'number'
     OR (p_backup->>'bytes')::numeric NOT BETWEEN 1 AND 5368709120
     OR pg_catalog.trunc((p_backup->>'bytes')::numeric)<>(p_backup->>'bytes')::numeric THEN
    RAISE EXCEPTION USING ERRCODE='RM005',MESSAGE='RESET_CONFIRMATION_INVALID';
  END IF;
  IF EXISTS(SELECT 1 FROM restamarket_control.sales_reset_ledger l WHERE l.reset_id=p_reset_id) THEN
    RAISE EXCEPTION USING ERRCODE='RM005',MESSAGE='RESET_ALREADY_CONSUMED';
  END IF;
  INSERT INTO restamarket_control.sales_reset_ledger(reset_id,ordinal,actor_user_id,started_at,reason,backup)
    VALUES(p_reset_id,policy.used_count+1,p_actor,p_started_at,pg_catalog.btrim(p_reason),p_backup);
  UPDATE restamarket_control.sales_reset_policy SET used_count=policy.used_count+1,
    exhausted_at=CASE WHEN policy.used_count+1=3 THEN pg_catalog.clock_timestamp() ELSE NULL END WHERE singleton;
  RETURN restamarket_control.read_sales_reset_policy(p_actor);
END
$function$;

CREATE OR REPLACE FUNCTION restamarket_control.initialize_sales_reset_policy(p_master uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog
AS $function$
DECLARE
  policy restamarket_control.sales_reset_policy%ROWTYPE;
  legacy_count integer;
  legacy_record record;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('restamarket.initialize-sales-reset'));
  IF p_master IS NULL OR NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=p_master AND u.role='admin'
    AND u.is_active=true AND u.password_hash IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='RM002',MESSAGE='An explicit active master administrator UUID is required';
  END IF;
  SELECT p.* INTO policy FROM restamarket_control.sales_reset_policy p WHERE p.singleton FOR UPDATE;
  IF FOUND THEN
    IF policy.master_user_id<>p_master THEN
      RAISE EXCEPTION USING ERRCODE='RM002',MESSAGE='The master administrator is already pinned; this script cannot replace it';
    END IF;
    RETURN restamarket_control.read_sales_reset_policy(p_master);
  END IF;
  IF EXISTS(SELECT 1 FROM restamarket_control.sales_reset_ledger) THEN
    RAISE EXCEPTION USING ERRCODE='RM004',MESSAGE='RESET_POLICY_INVALID';
  END IF;
  -- Existing successful period resets count; rerunning this file never replenishes
  -- the quota. More than three legacy resets is ambiguous and fails for review.
  SELECT pg_catalog.count(*)::integer INTO legacy_count FROM public.audit_logs a WHERE a.action='sales.period_reset';
  IF legacy_count>3 OR EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.action='sales.period_reset' AND a.entity_id IS NULL)
    OR (SELECT pg_catalog.count(DISTINCT a.entity_id) FROM public.audit_logs a WHERE a.action='sales.period_reset')<>legacy_count THEN
    RAISE EXCEPTION USING ERRCODE='RM004',MESSAGE='Historical reset usage requires operator review';
  END IF;
  INSERT INTO restamarket_control.sales_reset_policy(singleton,master_user_id,used_count,exhausted_at)
    VALUES(true,p_master,legacy_count,CASE WHEN legacy_count=3 THEN pg_catalog.clock_timestamp() ELSE NULL END);
  FOR legacy_record IN SELECT a.entity_id,a.user_id,a.created_at,
    pg_catalog.row_number() OVER(ORDER BY a.created_at,a.id)::smallint ordinal
    FROM public.audit_logs a WHERE a.action='sales.period_reset' ORDER BY a.created_at,a.id LOOP
    INSERT INTO restamarket_control.sales_reset_ledger(reset_id,ordinal,actor_user_id,started_at,reason,consumed_at,legacy)
      VALUES(legacy_record.entity_id,legacy_record.ordinal,COALESCE(legacy_record.user_id,p_master),legacy_record.created_at,
        'Legacy reporting-period reset',legacy_record.created_at,true);
  END LOOP;
  RETURN restamarket_control.read_sales_reset_policy(p_master);
END
$function$;

REVOKE ALL ON ALL TABLES IN SCHEMA restamarket_control FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA restamarket_control FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA restamarket_control REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA restamarket_control REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $grants$
DECLARE app_role name:=pg_catalog.current_setting('restamarket.application_role');
BEGIN
  EXECUTE pg_catalog.format('REVOKE ALL ON SCHEMA restamarket_control FROM %I',app_role);
  EXECUTE pg_catalog.format('REVOKE ALL ON ALL TABLES IN SCHEMA restamarket_control FROM %I',app_role);
  EXECUTE pg_catalog.format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA restamarket_control FROM %I',app_role);
  EXECUTE pg_catalog.format('GRANT USAGE ON SCHEMA restamarket_control TO %I',app_role);
  EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION restamarket_control.read_sales_reset_policy(uuid) TO %I',app_role);
  EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION restamarket_control.consume_sales_reset(uuid,uuid,timestamptz,text,jsonb) TO %I',app_role);
END
$grants$;

COMMIT;
