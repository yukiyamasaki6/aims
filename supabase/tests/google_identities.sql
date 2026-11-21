-- Googleで作ったアカウントがOTPでサインインできる状態を守る、ensure_email_identity()とトリガーkeep_email_identityを確認する。
--   - ensure_email_identity: Googleだけの確認済みの利用者にだけ、認証サービスが作る形と同じメールの手段を作る。冪等で、他人の行は変えない
--   - keep_email_identity: 確認済みの利用者が残ったまま、メールの手段だけを削除することを拒否する。Googleの削除、アカウント削除の連鎖、メールアドレス変更による更新は通す
-- 結果と、呼び出し前後のauth.usersとauth.identitiesの全体の同一性を、期待値表と全件比較する。
-- 権限(EXECUTE)は rls_matrix.sql の関数EXECUTE表が固定する。同時の呼び出しで2行作らないこと(利用者の行のロック)は、pgTAPで再現できないため確かめない。

begin;

select plan(8);

-- ============================================================
-- fixture
-- ============================================================

create function pg_temp.uid(p_alias text) returns uuid
language sql immutable
as $$ select md5('google_identities/' || p_alias)::uuid $$;

-- p_confirmedがfalseなら未確認、p_sso・p_deletedで特殊な利用者を作る。
create function pg_temp.mk_user(p_alias text, p_email text, p_confirmed boolean default true, p_sso boolean default false, p_deleted boolean default false) returns void
language sql
as $$
  insert into auth.users (id, email, email_confirmed_at, is_sso_user, deleted_at)
  values (pg_temp.uid(p_alias), p_email, case when p_confirmed then now() end, p_sso, case when p_deleted then now() end)
$$;

create function pg_temp.mk_google(p_alias text) returns void
language sql
as $$
  insert into auth.identities (provider_id, user_id, identity_data, provider)
  values ('google-sub-' || p_alias, pg_temp.uid(p_alias),
    jsonb_build_object('sub', 'google-sub-' || p_alias, 'email', p_alias || '@example.test', 'email_verified', true), 'google')
$$;

create function pg_temp.mk_email(p_alias text) returns void
language sql
as $$
  insert into auth.identities (provider_id, user_id, identity_data, provider)
  values (pg_temp.uid(p_alias)::text, pg_temp.uid(p_alias),
    jsonb_build_object('sub', pg_temp.uid(p_alias)::text, 'email', p_alias || '@example.test', 'email_verified', true, 'phone_verified', false), 'email')
$$;

-- ensure_email_identity()の対象。
select pg_temp.mk_user('ga', 'ga@example.test');
select pg_temp.mk_google('ga');
select pg_temp.mk_user('gb', 'gb@example.test');
select pg_temp.mk_google('gb');
-- すでにメールの手段がある。
select pg_temp.mk_user('eg', 'eg@example.test');
select pg_temp.mk_email('eg');
select pg_temp.mk_google('eg');
-- 作らない形(メールアドレスが空、未確認、SSO、削除済み)。
select pg_temp.mk_user('noemail', null);
select pg_temp.mk_google('noemail');
select pg_temp.mk_user('unconfirmed', 'unconfirmed@example.test', false);
select pg_temp.mk_google('unconfirmed');
select pg_temp.mk_user('sso', 'sso@example.test', true, true);
select pg_temp.mk_google('sso');
select pg_temp.mk_user('deleted', 'deleted@example.test', true, false, true);
select pg_temp.mk_google('deleted');

-- 認証サービスの契約(期待値の根拠)。ga作成直後のGoogleの手段と利用者を控える。
create temp table bef_ga_google as select * from auth.identities where user_id = pg_temp.uid('ga') and provider = 'google';
create temp table bef_ga_user as select id, email, raw_app_meta_data, raw_user_meta_data from auth.users where id = pg_temp.uid('ga');

-- auth.usersとauth.identitiesの全体の指紋。
create function pg_temp.snapshot() returns text
language sql stable
as $$
  select md5(
    (select coalesce(jsonb_agg(to_jsonb(u) order by to_jsonb(u)::text), '[]') from auth.users u)::text
    || (select coalesce(jsonb_agg(to_jsonb(i) order by to_jsonb(i)::text), '[]') from auth.identities i)::text)
$$;

create temp table ensure_actual(label text primary key, result text, changed boolean);

-- p_roleとして、sub = p_uidのJWTで呼び、結果と、全体が変わったかを記録する。
create function pg_temp.run_ensure(p_label text, p_uid uuid, p_role text default 'authenticated') returns void
language plpgsql
as $$
declare
  v_before text := pg_temp.snapshot();
  v_result text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', p_role)::text, true);
  execute format('set local role %I', p_role);
  begin
    perform public.ensure_email_identity();
    v_result := 'ok';
  exception when others then
    v_result := 'error:' || sqlstate;
  end;
  reset role;
  insert into ensure_actual values (p_label, v_result, pg_temp.snapshot() is distinct from v_before);
end;
$$;

-- ============================================================
-- ensure_email_identity(): 結果と変更の有無
-- ============================================================

select pg_temp.run_ensure('Googleだけの確認済みの利用者', pg_temp.uid('ga'));
create temp table ga_after_first as select * from auth.identities where user_id = pg_temp.uid('ga');
select pg_temp.run_ensure('もう一度呼ぶ(冪等)', pg_temp.uid('ga'));
select pg_temp.run_ensure('すでにメールの手段がある', pg_temp.uid('eg'));
select pg_temp.run_ensure('メールアドレスが空', pg_temp.uid('noemail'));
select pg_temp.run_ensure('未確認', pg_temp.uid('unconfirmed'));
select pg_temp.run_ensure('SSOの利用者', pg_temp.uid('sso'));
select pg_temp.run_ensure('削除済み', pg_temp.uid('deleted'));
select pg_temp.run_ensure('削除済みの利用者のID', '00000000-0000-4000-8000-000000000001');
select pg_temp.run_ensure('anonロール', pg_temp.uid('ga'), 'anon');
select pg_temp.run_ensure('認証されていない', null);

create temp table ensure_expected(label text primary key, result text, changed boolean);
insert into ensure_expected values
  ('Googleだけの確認済みの利用者', 'ok', true),
  ('もう一度呼ぶ(冪等)', 'ok', false),
  ('すでにメールの手段がある', 'ok', false),
  ('メールアドレスが空', 'error:PT403', false),
  ('未確認', 'error:PT403', false),
  ('SSOの利用者', 'error:PT403', false),
  ('削除済み', 'error:PT403', false),
  ('削除済みの利用者のID', 'error:PT403', false),
  ('anonロール', 'error:42501', false),
  ('認証されていない', 'error:PT403', false);

select is_empty(
  $$select coalesce(a.label, e.label) as label, a.result, a.changed, e.result as expected_result, e.changed as expected_changed
    from ensure_actual a full join ensure_expected e on a.label = e.label
    where (a.result, a.changed) is distinct from (e.result, e.changed)$$,
  'ensure_email_identity()の結果と、auth.users・auth.identities全体の変更の有無が、期待値表と全件一致する'
);

select results_eq(
  $$select provider, provider_id, identity_data, last_sign_in_at is not null from auth.identities
    where user_id = pg_temp.uid('ga') and provider = 'email'$$,
  $$values ('email'::text, pg_temp.uid('ga')::text,
    jsonb_build_object('sub', pg_temp.uid('ga')::text, 'email', 'ga@example.test', 'email_verified', true, 'phone_verified', false), true)$$,
  '作られたメールの手段は、認証サービスがメールアドレスの変更の完了時に作る形(provider_idは利用者のID、確認済み、last_sign_in_atあり)である'
);

select results_eq(
  $$select (select count(*) from auth.identities where user_id = pg_temp.uid('ga')),
    (select count(*) from ga_after_first where provider = 'email')$$,
  $$values (2::bigint, 1::bigint)$$,
  '呼び出しの後にメールの手段は1行で、もう一度呼んでも増えない'
);

select results_eq(
  $$select (select count(*) from (select * from bef_ga_google except select * from auth.identities) d),
    (select count(*) from (select id, email, raw_app_meta_data, raw_user_meta_data from auth.users where id = pg_temp.uid('ga') except select * from bef_ga_user) d)$$,
  $$values (0::bigint, 0::bigint)$$,
  'Googleの手段と、利用者のメールアドレス・app_metadata・user_metadataは変わらない'
);

select results_eq(
  $$select (select count(*) from auth.identities where user_id = pg_temp.uid('gb') and provider = 'email'),
    (select count(*) from auth.identities where user_id = pg_temp.uid('ga') and provider = 'email')$$,
  $$values (0::bigint, 1::bigint)$$,
  '呼び出した利用者(ga)の手段だけが作られ、他のGoogleだけの利用者(gb)には作られない'
);

-- ============================================================
-- keep_email_identity: auth.identitiesへの操作(認証サービスと同じ直接のSQL)
-- ============================================================

-- 各行は専用の利用者を持つ。
select pg_temp.mk_user('t1', 't1@example.test');  select pg_temp.mk_email('t1');
select pg_temp.mk_user('t2', 't2@example.test');  select pg_temp.mk_email('t2');  select pg_temp.mk_google('t2');
select pg_temp.mk_user('t3', 't3@example.test', false);  select pg_temp.mk_email('t3');
select pg_temp.mk_user('t4', 't4@example.test');  select pg_temp.mk_email('t4');  select pg_temp.mk_google('t4');
select pg_temp.mk_user('t5', 't5@example.test');  select pg_temp.mk_google('t5');
select pg_temp.mk_user('t6', 't6@example.test');  select pg_temp.mk_email('t6');
select pg_temp.mk_user('t7', 't7@example.test');  select pg_temp.mk_email('t7');

create temp table trigger_actual(label text primary key, result text, changed boolean);

create function pg_temp.run_op(p_label text, p_sql text) returns void
language plpgsql
as $$
declare
  v_before text := pg_temp.snapshot();
  v_result text;
begin
  begin
    execute p_sql;
    v_result := 'ok';
  exception when others then
    v_result := 'error:' || sqlerrm;
  end;
  insert into trigger_actual values (p_label, v_result, pg_temp.snapshot() is distinct from v_before);
end;
$$;

select pg_temp.run_op('確認済みのアカウントを残したままメールの手段を削除する',
  format('delete from auth.identities where user_id = %L and provider = ''email''', pg_temp.uid('t1')));
select pg_temp.run_op('メール+Googleの利用者のメールの手段を削除する',
  format('delete from auth.identities where user_id = %L and provider = ''email''', pg_temp.uid('t2')));
select pg_temp.run_op('未確認の利用者のメールの手段を削除する',
  format('delete from auth.identities where user_id = %L and provider = ''email''', pg_temp.uid('t3')));
select pg_temp.run_op('Googleの手段を削除する',
  format('delete from auth.identities where user_id = %L and provider = ''google''', pg_temp.uid('t4')));
select pg_temp.run_op('Googleだけの利用者のGoogleの手段を削除する',
  format('delete from auth.identities where user_id = %L and provider = ''google''', pg_temp.uid('t5')));
select pg_temp.run_op('アカウントを削除する(連鎖)',
  format('delete from auth.users where id = %L', pg_temp.uid('t6')));
select pg_temp.run_op('メール変更の完了の更新',
  format('update auth.identities set provider_id = %L, identity_data = identity_data || jsonb_build_object(''email'', ''changed@example.test'') where user_id = %L and provider = ''email''', 't7-changed', pg_temp.uid('t7')));

create temp table trigger_expected(label text primary key, result text, changed boolean);
insert into trigger_expected values
  ('確認済みのアカウントを残したままメールの手段を削除する', 'error:email_identity_required', false),
  ('メール+Googleの利用者のメールの手段を削除する', 'error:email_identity_required', false),
  ('未確認の利用者のメールの手段を削除する', 'ok', true),
  ('Googleの手段を削除する', 'ok', true),
  ('Googleだけの利用者のGoogleの手段を削除する', 'ok', true),
  ('アカウントを削除する(連鎖)', 'ok', true),
  ('メール変更の完了の更新', 'ok', true);

select is_empty(
  $$select coalesce(a.label, e.label) as label, a.result, a.changed, e.result as expected_result, e.changed as expected_changed
    from trigger_actual a full join trigger_expected e on a.label = e.label
    where (a.result, a.changed) is distinct from (e.result, e.changed)$$,
  'メールの手段への操作の結果と、全体の変更の有無が、期待値表と全件一致する(拒否された操作は何も変えない)'
);

-- 関数→Googleの削除の順: Googleだけの利用者の削除の後もメールの手段が残る。
select pg_temp.run_ensure('削除の前の準備', pg_temp.uid('gb'));
delete from auth.identities where user_id = pg_temp.uid('gb') and provider = 'google';
select results_eq(
  $$select provider from auth.identities where user_id = pg_temp.uid('gb')$$,
  $$values ('email'::text)$$,
  'メールの手段を作った後はGoogleの手段を削除でき、その後もメールの手段が残る'
);

select is(
  (select count(*) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('ensure_email_identity', 'keep_email_identity')
      and p.prosecdef and p.proconfig = array['search_path=""']),
  2::bigint,
  '2つの関数はSECURITY DEFINERでsearch_pathが空である'
);

select * from finish();

rollback;
