begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

INSERT INTO "auth"."users" ("instance_id", "id", "aud", "role", "banned_until", "created_at", "updated_at")
VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'infinity', now(), now())
ON CONFLICT ("id") DO NOTHING;

CREATE EXTENSION IF NOT EXISTS "http" WITH SCHEMA "extensions";

CREATE FUNCTION "public"."purge_account"(target_user_id uuid) RETURNS void
    LANGUAGE "plpgsql" SECURITY INVOKER
    SET "search_path" TO ''
    AS $$
declare
  v_deleted_user constant uuid := '00000000-0000-4000-8000-000000000001';
  v_round_ids uuid[];
begin
  if target_user_id is null or target_user_id = v_deleted_user then
    raise exception 'account_purge_forbidden';
  end if;

  if not exists (select 1 from auth.users where id = target_user_id) then
    return;
  end if;

  select coalesce(array_agg(ru.round_id), '{}')
  into v_round_ids
  from public.round_users ru
  where ru.user_id = target_user_id
    and not exists (
      select 1
      from public.round_users other
      where other.round_id = ru.round_id
        and other.role = 'editor'
        and other.user_id <> target_user_id
    );

  delete from public.shot_events
  where distance_id in (select d.id from public.distances d where d.round_id = any (v_round_ids));
  delete from public.distance_events where round_id = any (v_round_ids);
  delete from public.round_events where round_id = any (v_round_ids);
  delete from public.rounds where id = any (v_round_ids);

  update public.shots set shooter_id = v_deleted_user where shooter_id = target_user_id;
  update public.shot_events set shooter_id = v_deleted_user where shooter_id = target_user_id;
  update public.shot_events set author_id = v_deleted_user where author_id = target_user_id;
  update public.distance_events set author_id = v_deleted_user where author_id = target_user_id;
  update public.round_events set author_id = v_deleted_user where author_id = target_user_id;

  delete from auth.users where id = target_user_id;
end;
$$;

ALTER FUNCTION "public"."purge_account"(uuid) OWNER TO "postgres";

REVOKE EXECUTE ON FUNCTION "public"."purge_account"(uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

CREATE OR REPLACE FUNCTION "public"."delete_account"(expected_user_id uuid) RETURNS void
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "statement_timeout" TO '60s'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_deleted_user constant uuid := '00000000-0000-4000-8000-000000000001';
  v_amr jsonb := coalesce(auth.jwt() -> 'amr', '[]'::jsonb);
  v_checked_at numeric;
  v_endpoint text;
  v_key text;
  v_status integer;
begin
  if v_uid is null or v_uid = v_deleted_user or expected_user_id is distinct from v_uid then
    raise exception 'account_deletion_forbidden' using errcode = 'PT403';
  end if;

  -- 同じ利用者の別端末の書き込み(外部キーの検査が行を共有ロックする)と直列にする。行が無ければ、削除済み。
  perform 1 from public.users where id = v_uid for update;
  if not found then
    raise exception 'account_deletion_forbidden' using errcode = 'PT403';
  end if;

  v_checked_at := extract(epoch from clock_timestamp());
  if jsonb_typeof(v_amr) is distinct from 'array' then
    raise exception 'otp_confirmation_required' using errcode = 'PT403';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_amr) as e
    where e ->> 'method' = 'otp'
      and case when jsonb_typeof(e -> 'timestamp') = 'number'
        then (e ->> 'timestamp')::numeric between v_checked_at - 60 and v_checked_at
        else false end
  ) then
    raise exception 'otp_confirmation_required' using errcode = 'PT403';
  end if;

  perform public.purge_account(v_uid);

  -- 削除の記録を、バックアップの外(R2のdeletions/)へ同期に書く。書けなければ例外で削除を取り消す。
  select s.decrypted_secret into v_endpoint
  from vault.decrypted_secrets s where s.name = 'account_deletion_log_endpoint';
  if v_endpoint is null then
    raise exception 'account_deletion_log_unconfigured';
  end if;
  if v_endpoint = 'disabled' then
    return;
  end if;

  select s.decrypted_secret into v_key
  from vault.decrypted_secrets s where s.name = 'account_deletion_log_key';
  if v_key is null then
    raise exception 'account_deletion_log_unconfigured';
  end if;

  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '3000');
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '5000');
  select r.status into v_status
  from extensions.http((
    'POST',
    v_endpoint,
    array[extensions.http_header('Authorization', 'Bearer ' || v_key)],
    'application/json',
    jsonb_build_object('user_id', v_uid)::text
  )::extensions.http_request) as r;
  if v_status is null or v_status not between 200 and 299 then
    raise exception 'account_deletion_log_failed';
  end if;
end;
$$;

ALTER FUNCTION "public"."delete_account"(uuid) OWNER TO "postgres";

REVOKE EXECUTE ON FUNCTION "public"."delete_account"(uuid) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."delete_account"(uuid) TO "authenticated";

commit;
