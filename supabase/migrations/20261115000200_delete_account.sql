-- アカウント削除(auth/delete-account)のDB側。
--   - 「削除済みの利用者」(00000000-0000-4000-8000-000000000001)を、サインインできない利用者としてauth.usersに1行作る。handle_new_userがpublic.usersの行を作る。匿名化の置き先になる
--   - delete_account(): 呼び出した利用者のアカウントと記録を、1トランザクションで削除・匿名化する。SECURITY DEFINERで、service_roleと管理APIは使わない
--     認可: auth.uid()があり「削除済みの利用者」でないこと、JWTのamrにmethod=passwordで直近60秒のtimestampがあること。満たさなければPT403で何も変えない
--     削除: 利用者を除くと編集者がいなくなるラウンド(利用者が参加し、他の編集者がいないもの)の、3つの変更履歴(論理FKのため明示して消す)とラウンド(距離・矢・参加は連鎖)
--     匿名化: 利用者のIDに一致する全行の、矢の射手、矢の変更履歴の射手と操作者、距離・ラウンドの履歴の操作者を、「削除済みの利用者」に置き換える
--     最後にauth.usersを消す(public.users、参加、個人のプリセット、セッション、リフレッシュトークン、identitiesが連鎖で消える)
--   - statement_timeoutを60sにする(APIのauthenticatedの既定は8秒で、矢の多い利用者の削除が制限時間で取り消されるため)
--   - 実行権限はauthenticatedだけに与える
--   - 戻すときは、逆の内容の追加のmigrationで行う

begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

INSERT INTO "auth"."users" ("instance_id", "id", "aud", "role", "banned_until", "created_at", "updated_at")
VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'infinity', now(), now())
ON CONFLICT ("id") DO NOTHING;

CREATE OR REPLACE FUNCTION "public"."delete_account"() RETURNS void
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "statement_timeout" TO '60s'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_deleted_user constant uuid := '00000000-0000-4000-8000-000000000001';
  v_amr jsonb := coalesce(auth.jwt() -> 'amr', '[]'::jsonb);
  v_round_ids uuid[];
begin
  if v_uid is null or v_uid = v_deleted_user then
    raise exception 'アカウントを削除する権限がありません。' using errcode = 'PT403';
  end if;

  if jsonb_typeof(v_amr) is distinct from 'array' or not exists (
    select 1
    from jsonb_array_elements(v_amr) as e
    where e ->> 'method' = 'password'
      and (e ->> 'timestamp')::numeric >= extract(epoch from now()) - 60
  ) then
    raise exception '現在のパスワードによる再認証が必要です。' using errcode = 'PT403';
  end if;

  -- 同じ利用者の別端末の書き込み(外部キーの検査が行を共有ロックする)と直列にする。行が無ければ、削除済み。
  perform 1 from public.users where id = v_uid for update;
  if not found then
    raise exception 'アカウントを削除する権限がありません。' using errcode = 'PT403';
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

ALTER FUNCTION "public"."delete_account"() OWNER TO "postgres";

REVOKE EXECUTE ON FUNCTION "public"."delete_account"() FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."delete_account"() TO "authenticated";

commit;
