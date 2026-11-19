begin;
set lock_timeout = '1s';
set statement_timeout = '5s';

CREATE FUNCTION public.email_otp_access_token_hook(event jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
begin
  if event ->> 'authentication_method' in ('otp', 'token_refresh', 'email_change') then
    return jsonb_build_object('claims', event -> 'claims');
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'authentication_method_not_allowed'));
end;
$$;
REVOKE EXECUTE ON FUNCTION public.email_otp_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.email_otp_access_token_hook(jsonb) TO supabase_auth_admin;

DROP FUNCTION public.delete_account();

CREATE OR REPLACE FUNCTION "public"."delete_account"(expected_user_id uuid) RETURNS void
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "statement_timeout" TO '60s'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_deleted_user constant uuid := '00000000-0000-4000-8000-000000000001';
  v_amr jsonb := coalesce(auth.jwt() -> 'amr', '[]'::jsonb);
  v_round_ids uuid[];
  v_checked_at numeric;
begin
  if v_uid is null or v_uid = v_deleted_user or expected_user_id is distinct from v_uid then
    raise exception 'account_deletion_forbidden' using errcode = 'PT403';
  end if;

  -- 同じ利用者の別端末の書き込み(外部キーの検査が行を共有ロックする)と直列にする。行が無ければ、削除済み。
  perform 1 from public.users where id = v_uid for update;
  if not found then
    raise exception 'account_deletion_forbidden' using errcode = 'PT403';
  end if;

  select coalesce(array_agg(ru.round_id), '{}')
  into v_round_ids
  from public.round_users ru
  where ru.user_id = v_uid
    and not exists (
      select 1
      from public.round_users other
      where other.round_id = ru.round_id
        and other.role = 'editor'
        and other.user_id <> v_uid
    );

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

  delete from public.shot_events
  where distance_id in (select d.id from public.distances d where d.round_id = any (v_round_ids));
  delete from public.distance_events where round_id = any (v_round_ids);
  delete from public.round_events where round_id = any (v_round_ids);
  delete from public.rounds where id = any (v_round_ids);

  update public.shots set shooter_id = v_deleted_user where shooter_id = v_uid;
  update public.shot_events set shooter_id = v_deleted_user where shooter_id = v_uid;
  update public.shot_events set author_id = v_deleted_user where author_id = v_uid;
  update public.distance_events set author_id = v_deleted_user where author_id = v_uid;
  update public.round_events set author_id = v_deleted_user where author_id = v_uid;

  delete from auth.users where id = v_uid;
end;
$$;

ALTER FUNCTION "public"."delete_account"(uuid) OWNER TO "postgres";

REVOKE EXECUTE ON FUNCTION "public"."delete_account"(uuid) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."delete_account"(uuid) TO "authenticated";

commit;
