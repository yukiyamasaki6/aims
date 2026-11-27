begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';


-- postgresが今後publicに作る表とシーケンスに、anon・authenticatedへの権限が自動で付かないようにする。
-- 必要な権限は、表ごとに明示的に付ける。
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon", "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "anon", "authenticated";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" PRIMARY KEY,
    "name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.users (id)
  values (new.id);
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE TRIGGER "set_users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


CREATE POLICY "select_own" ON "public"."users" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "id"));


CREATE POLICY "update_own" ON "public"."users" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


REVOKE EXECUTE ON FUNCTION "public"."handle_new_user"() FROM PUBLIC, "anon", "authenticated";


REVOKE EXECUTE ON FUNCTION "public"."set_updated_at"() FROM PUBLIC, "anon", "authenticated";




GRANT SELECT,UPDATE ON TABLE "public"."users" TO "authenticated";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


CREATE TRIGGER "on_auth_user_created"
    AFTER INSERT ON "auth"."users"
    FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();

-- Supabaseの既定権限から、不要な権限を除く。
REVOKE REFERENCES, TRIGGER, TRUNCATE, MAINTAIN ON TABLE "public"."users" FROM "service_role";

CREATE OR REPLACE FUNCTION public.email_otp_access_token_hook(event jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
begin
  if event ->> 'authentication_method' in ('otp', 'token_refresh', 'email_change', 'oauth') then
    return jsonb_build_object('claims', event -> 'claims');
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'authentication_method_not_allowed'));
end;
$$;

CREATE FUNCTION public.ensure_email_identity() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
declare
  v_uid uuid := auth.uid();
  v_deleted_user constant uuid := '00000000-0000-4000-8000-000000000001';
  v_email text;
begin
  if v_uid is null or v_uid = v_deleted_user then
    raise exception 'email_identity_forbidden' using errcode = 'PT403';
  end if;

  -- 同じ利用者の同時の呼び出しで2行作らないよう、利用者の行をロックする。確認済みのアドレスを持つ利用者だけが対象。
  select u.email into v_email
  from auth.users u
  where u.id = v_uid
    and u.email_confirmed_at is not null
    and coalesce(u.email, '') <> ''
    and not u.is_sso_user
    and u.deleted_at is null
  for update;
  if not found then
    raise exception 'email_identity_forbidden' using errcode = 'PT403';
  end if;

  if exists (
    select 1 from auth.identities i where i.user_id = v_uid and i.provider = 'email'
  ) then
    return;
  end if;

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    v_uid::text,
    v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    'email',
    now(),
    now(),
    now()
  );
end;
$$;

ALTER FUNCTION public.ensure_email_identity() OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.ensure_email_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_email_identity() TO authenticated;

CREATE FUNCTION public.keep_email_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
begin
  -- 利用者の削除の連鎖では、利用者の行が先に消えているため通る。確認していない利用者は、認証サービスが未確認のメールの手段を消すため通す。
  if exists (
    select 1 from auth.users u where u.id = old.user_id and u.email_confirmed_at is not null
  ) then
    raise exception 'email_identity_required';
  end if;
  return old;
end;
$$;

ALTER FUNCTION public.keep_email_identity() OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.keep_email_identity() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER keep_email_identity
    BEFORE DELETE ON auth.identities
    FOR EACH ROW
    WHEN (old.provider = 'email')
    EXECUTE FUNCTION public.keep_email_identity();

REVOKE EXECUTE ON FUNCTION public.email_otp_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.email_otp_access_token_hook(jsonb) TO supabase_auth_admin;

commit;
