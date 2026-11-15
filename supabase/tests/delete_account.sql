-- アカウント削除(delete_account)の振る舞いを確認する。
--   - 認可: 認証済みで、JWTのamrにpasswordの認証が直近60秒以内にあること。満たさない呼び出しは何も変えずにPT403で拒否する
--   - 削除: 他に編集者がいないラウンドは全ての状態で消え、利用者のプロフィール・参加・個人のプリセット・認証の行も消える
--   - 匿名化: 他の編集者が残るラウンドの矢・履歴は残り、利用者を指す列だけが「削除済みの利用者」に置き換わる
--   - 再登録と旧トークン、原子性、関数の属性
-- 権限(anonとauthenticatedのEXECUTE)は rls_matrix.sql の関数EXECUTE表が固定する。
-- ラウンドの形は実際のデータに合わせ、屋外の12エンド×3射の距離を1つ持つ。

begin;

select plan(35);

-- ============================================================
-- fixture
-- ============================================================

-- 別名から固定のuuidを作る。
create function pg_temp.uid(p_alias text) returns uuid
language sql immutable
as $$ select md5('delete_account/' || p_alias)::uuid $$;

create function pg_temp.deleted_user() returns uuid
language sql immutable
as $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;

create function pg_temp.face() returns uuid
language sql stable
as $$ select id from public.target_faces order by id limit 1 $$;

create function pg_temp.mk_user(p_alias text, p_email text default null, p_name text default null) returns void
language plpgsql
as $$
begin
  insert into auth.users (id, email) values (pg_temp.uid(p_alias), p_email);
  if p_name is not null then
    update public.users set name = p_name where id = pg_temp.uid(p_alias);
  end if;
end;
$$;

-- ラウンドと、12エンド×3射の距離を1つ作る。作成者を編集者とし、作成の履歴を残す。
create function pg_temp.mk_round(p_alias text, p_author text, p_status text default 'in_progress', p_disabled boolean default false) returns void
language plpgsql
as $$
begin
  insert into public.rounds (id, name, round_date, format, bow_type, status, disabled_at)
  values (pg_temp.uid(p_alias), p_alias, '2026-09-10', 'outdoor', 'recurve', p_status, case when p_disabled then now() end);
  insert into public.round_users (round_id, user_id, role) values (pg_temp.uid(p_alias), pg_temp.uid(p_author), 'editor');
  insert into public.round_events (event_id, round_id, type, author_id, revision, name, round_date, format, bow_type, status)
  values (pg_temp.uid(p_alias || '.re1'), pg_temp.uid(p_alias), 'CREATED', pg_temp.uid(p_author), 1, p_alias, '2026-09-10', 'outdoor', 'recurve', p_status);
  insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked)
  values (pg_temp.uid(p_alias || '.d'), pg_temp.uid(p_alias), 'a', 70, 12, 3, pg_temp.face(), true);
  insert into public.distance_events (event_id, round_id, distance_id, type, author_id, revision, position_key, distance, is_marked, total_ends, arrows_per_end, target_face_id)
  values (pg_temp.uid(p_alias || '.de1'), pg_temp.uid(p_alias), pg_temp.uid(p_alias || '.d'), 'CREATED', pg_temp.uid(p_author), 1, 'a', 70, true, 12, 3, pg_temp.face());
end;
$$;

create function pg_temp.join_round(p_round text, p_user text, p_role text) returns void
language sql
as $$ insert into public.round_users (round_id, user_id, role) values (pg_temp.uid(p_round), pg_temp.uid(p_user), p_role) $$;

-- 距離に、1エンド目の矢と、その記録の履歴を足す。p_shooterが射手、p_authorが記録した操作者。
create function pg_temp.mk_shot(p_round text, p_n int, p_shooter text, p_author text) returns void
language plpgsql
as $$
declare
  v_id uuid := pg_temp.uid(p_round || '.s' || p_n);
begin
  insert into public.shots (id, distance_id, end_number, shooter_id, score_str, score_int, shot_number)
  values (v_id, pg_temp.uid(p_round || '.d'), 1, pg_temp.uid(p_shooter), '9', 9, p_n);
  insert into public.shot_events (event_id, distance_id, shot_id, type, author_id, revision, end_number, shooter_id, score_str, score_int, shot_number, set_fields)
  values (pg_temp.uid(p_round || '.se' || p_n), pg_temp.uid(p_round || '.d'), v_id, 'RECORDED', pg_temp.uid(p_author), 1, 1,
    pg_temp.uid(p_shooter), '9', 9, p_n, array['score', 'shooter_id', 'shot_number']);
end;
$$;

-- 距離とラウンドの更新の履歴を足す。
create function pg_temp.mk_edit(p_round text, p_author text) returns void
language plpgsql
as $$
begin
  insert into public.round_events (event_id, round_id, type, author_id, revision, name, set_fields)
  values (pg_temp.uid(p_round || '.re2.' || p_author), pg_temp.uid(p_round), 'UPDATED', pg_temp.uid(p_author),
    2 + (select count(*) from public.round_events where round_id = pg_temp.uid(p_round)) - 1, 'renamed', array['name']);
  insert into public.distance_events (event_id, round_id, distance_id, type, author_id, revision, distance, set_fields)
  values (pg_temp.uid(p_round || '.de2.' || p_author), pg_temp.uid(p_round), pg_temp.uid(p_round || '.d'), 'UPDATED', pg_temp.uid(p_author),
    2 + (select count(*) from public.distance_events where distance_id = pg_temp.uid(p_round || '.d')) - 1, 60, array['distance']);
end;
$$;

-- 認証の行(セッション、リフレッシュトークン、identities)を足す。
create function pg_temp.mk_auth_rows(p_user text) returns void
language plpgsql
as $$
begin
  insert into auth.sessions (id, user_id) values (pg_temp.uid(p_user || '.session'), pg_temp.uid(p_user));
  insert into auth.refresh_tokens (token, user_id, session_id) values (p_user || '-token', pg_temp.uid(p_user)::text, pg_temp.uid(p_user || '.session'));
  insert into auth.identities (provider_id, user_id, identity_data, provider)
  values (pg_temp.uid(p_user)::text, pg_temp.uid(p_user), jsonb_build_object('sub', pg_temp.uid(p_user)::text), 'email');
end;
$$;

-- 個人のプリセットと、その距離を作る。
create function pg_temp.mk_preset(p_alias text, p_owner text) returns void
language plpgsql
as $$
begin
  insert into public.preset_rounds (id, owner_id, name, format, bow_type)
  values (pg_temp.uid(p_alias), pg_temp.uid(p_owner), p_alias, 'outdoor', 'recurve');
  insert into public.preset_distances (preset_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked)
  values (pg_temp.uid(p_alias), 'a', 70, 12, 3, pg_temp.face(), true),
         (pg_temp.uid(p_alias), 'b', 60, 12, 3, pg_temp.face(), true);
end;
$$;

-- ---- 利用者 ----
-- Q: 拒否の確認用。T/O1/O2: 認可の境界と並びの確認用。X: 途中で失敗させる確認用。
-- S: 他に編集者がいないラウンドを持つ(Wが閲覧者)。A: 他の編集者Bが残るラウンドを持つ(Vが閲覧者)。
select pg_temp.mk_user('Q');
select pg_temp.mk_user('T');
select pg_temp.mk_user('O1');
select pg_temp.mk_user('O2');
select pg_temp.mk_user('X');
select pg_temp.mk_user('S', 'solo@example.test', 'Solo Archer');
select pg_temp.mk_user('W');
select pg_temp.mk_user('A', 'alice@example.test', 'Alice Archer');
select pg_temp.mk_user('B');
select pg_temp.mk_user('V');

-- Q: 自分だけのラウンドと、個人のプリセット。
select pg_temp.mk_round('Q1', 'Q');
select pg_temp.mk_shot('Q1', 1, 'Q', 'Q');
select pg_temp.mk_preset('Qp', 'Q');
select pg_temp.mk_auth_rows('Q');

-- X: 自分だけのラウンドと、他の編集者が残るラウンド。
select pg_temp.mk_round('X1', 'X');
select pg_temp.mk_shot('X1', 1, 'X', 'X');
select pg_temp.mk_round('X2', 'B');
select pg_temp.join_round('X2', 'X', 'editor');
select pg_temp.mk_shot('X2', 1, 'X', 'X');

-- S: 進行中・完了・論理削除済みの自分だけのラウンドと、閲覧者Wだけが残るラウンド。
select pg_temp.mk_round('S1', 'S', 'in_progress');
select pg_temp.mk_round('S2', 'S', 'completed');
select pg_temp.mk_round('S3', 'S', 'completed', true);
select pg_temp.mk_round('S4', 'S', 'in_progress');
select pg_temp.join_round('S4', 'W', 'viewer');
select pg_temp.mk_shot(r, 1, 'S', 'S') from unnest(array['S1', 'S2', 'S3', 'S4']) as r;
select pg_temp.mk_shot(r, 2, 'S', 'S') from unnest(array['S1', 'S2', 'S3', 'S4']) as r;
select pg_temp.mk_edit(r, 'S') from unnest(array['S1', 'S2', 'S3', 'S4']) as r;
select pg_temp.mk_preset('Sp', 'S');
select pg_temp.mk_auth_rows('S');
-- Wは自分だけのラウンドも持つ(削除の影響を受けない)。
select pg_temp.mk_round('W1', 'W');
select pg_temp.mk_shot('W1', 1, 'W', 'W');
select pg_temp.mk_preset('Wp', 'W');

-- A: 他の編集者Bが残るラウンドR1(Vは閲覧者)、Aが閲覧者のラウンドR2、Aが参加していないラウンドR3。
--   R1の矢: 1=射手A・記録A、2=射手A・記録B、3=射手B・記録A、4=射手B・記録B
--   R3は、Aの参加が外れた後にAの行が残った形(矢の射手、各履歴の操作者)
select pg_temp.mk_round('R1', 'A', 'completed');
select pg_temp.join_round('R1', 'B', 'editor');
select pg_temp.join_round('R1', 'V', 'viewer');
select pg_temp.mk_shot('R1', 1, 'A', 'A');
select pg_temp.mk_shot('R1', 2, 'A', 'B');
select pg_temp.mk_shot('R1', 3, 'B', 'A');
select pg_temp.mk_shot('R1', 4, 'B', 'B');
select pg_temp.mk_edit('R1', 'A');
select pg_temp.mk_edit('R1', 'B');
select pg_temp.mk_round('R2', 'B', 'completed');
select pg_temp.join_round('R2', 'A', 'viewer');
select pg_temp.mk_shot('R2', 1, 'B', 'B');
select pg_temp.mk_round('R3', 'A', 'completed');
select pg_temp.join_round('R3', 'B', 'editor');
select pg_temp.mk_shot('R3', 1, 'A', 'A');
select pg_temp.mk_shot('R3', 2, 'B', 'B');
select pg_temp.mk_edit('R3', 'A');
delete from public.round_users where round_id = pg_temp.uid('R3') and user_id = pg_temp.uid('A');
select pg_temp.mk_preset('Ap', 'A');
select pg_temp.mk_auth_rows('A');

-- ---- 呼び出しと測定の補助 ----

-- authenticatedまたはanonとして、JWTのクレームを設定して呼び、結果を 'ok' か 'error:<SQLSTATE>' で返す。
create function pg_temp.call_as(p_uid uuid, p_claims jsonb default '{}', p_role text default 'authenticated') returns text
language plpgsql
as $$
declare
  v_result text;
begin
  perform set_config('request.jwt.claims', (jsonb_build_object('sub', p_uid, 'role', p_role) || p_claims)::text, true);
  execute format('set local role %I', p_role);
  begin
    perform public.delete_account();
    v_result := 'ok';
  exception when others then
    v_result := 'error:' || sqlstate;
  end;
  reset role;
  return v_result;
end;
$$;

-- amrの要素。p_secondsは、現在から何秒前の認証か。
create function pg_temp.amr(p_method text, p_seconds int) returns jsonb
language sql stable
as $$ select jsonb_build_object('method', p_method, 'timestamp', floor(extract(epoch from now()))::bigint - p_seconds) $$;

create function pg_temp.fresh() returns jsonb
language sql stable
as $$ select jsonb_build_object('amr', jsonb_build_array(pg_temp.amr('password', 1))) $$;

-- 関連する全てのテーブルの内容の指紋。何も変わらないことを、全件の内容で比べる。
create function pg_temp.snapshot() returns jsonb
language plpgsql stable
as $$
declare
  v_table text;
  v_result jsonb := '{}';
  v_hash text;
begin
  foreach v_table in array array[
    'auth.users', 'auth.sessions', 'auth.refresh_tokens', 'auth.identities',
    'public.users', 'public.rounds', 'public.round_users', 'public.distances', 'public.shots',
    'public.shot_events', 'public.distance_events', 'public.round_events', 'public.preset_rounds', 'public.preset_distances'
  ] loop
    execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), ''[]'')::text) from %s t', v_table) into v_hash;
    v_result := v_result || jsonb_build_object(v_table, v_hash);
  end loop;
  return v_result;
end;
$$;

-- 利用者を指す全ての外部キーの列(public.usersとauth.usersを参照する全スキーマ)で、指定した利用者のIDを値に持つ行の数を数える。
create function pg_temp.leftover_refs(p_user uuid) returns bigint
language plpgsql
as $$
declare
  v_ref record;
  v_count bigint;
  v_total bigint := 0;
begin
  for v_ref in
    select c.conrelid::regclass::text as tbl, a.attname::text as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid in ('public.users'::regclass, 'auth.users'::regclass)
  loop
    execute format('select count(*) from %s where %I::text = $1::text', v_ref.tbl, v_ref.col) into v_count using p_user;
    v_total := v_total + v_count;
  end loop;
  return v_total;
end;
$$;

-- 削除の前の状態を控える(匿名化の前後を比べるため)。
create temp table bef_shots as select * from public.shots;
create temp table bef_shot_events as select * from public.shot_events;
create temp table bef_distance_events as select * from public.distance_events;
create temp table bef_round_events as select * from public.round_events;
create temp table bef_rounds as select * from public.rounds;
create temp table bef_distances as select * from public.distances;
create temp table bef_round_users as select * from public.round_users;
create temp table bef_users as select * from public.users;

-- ============================================================
-- A1 認可: 満たさない呼び出しは、何も変えずに拒否される
-- ============================================================

create temp table da_reject (label text primary key, uid uuid, role text not null, claims jsonb not null, expected text not null);
insert into da_reject (label, uid, role, claims, expected) values
  ('認証されていない(auth.uid()が無い)', null, 'authenticated', pg_temp.fresh(), 'error:PT403'),
  ('anonロールにはEXECUTE権限が無い', null, 'anon', pg_temp.fresh(), 'error:42501'),
  ('amrが無い', pg_temp.uid('Q'), 'authenticated', '{}', 'error:PT403'),
  ('amrが空の配列', pg_temp.uid('Q'), 'authenticated', '{"amr":[]}', 'error:PT403'),
  ('amrが配列でない', pg_temp.uid('Q'), 'authenticated', '{"amr":{"method":"password"}}', 'error:PT403'),
  ('認証コード(otp)の認証だけを持つ', pg_temp.uid('Q'), 'authenticated',
    jsonb_build_object('amr', jsonb_build_array(pg_temp.amr('otp', 1))), 'error:PT403'),
  ('パスワードの認証が61秒前だけ', pg_temp.uid('Q'), 'authenticated',
    jsonb_build_object('amr', jsonb_build_array(pg_temp.amr('password', 61))), 'error:PT403'),
  ('パスワードの認証が61秒前で、認証コードが1秒前(認証コードはパスワードの鮮度の代わりにならない)', pg_temp.uid('Q'), 'authenticated',
    jsonb_build_object('amr', jsonb_build_array(pg_temp.amr('password', 61), pg_temp.amr('otp', 1))), 'error:PT403'),
  ('削除済みの利用者のID(鮮度は満たす)', pg_temp.deleted_user(), 'authenticated', pg_temp.fresh(), 'error:PT403'),
  ('存在しない利用者のID(鮮度は満たす)', pg_temp.uid('nobody'), 'authenticated', pg_temp.fresh(), 'error:PT403');

create temp table da_before as select pg_temp.snapshot() as snap;
create temp table da_reject_result as
select label, pg_temp.call_as(uid, claims, role) as actual, expected from da_reject;

select is_empty(
  $$select label, actual, expected from da_reject_result where actual is distinct from expected$$,
  '認可を満たさない呼び出しは、権限の拒否(42501)とPT403を区別して、全て拒否される'
);

select is(
  pg_temp.snapshot(),
  (select snap from da_before),
  '拒否された呼び出しの後、利用者・ラウンド・矢・履歴・参加・プリセット・認証の行が呼び出し前と同一である'
);

-- 境界(61秒前は拒否、59秒前は成功)。60秒ちょうどは、整数秒のtimestampと小数秒のnow()の比較が実装の細部になるため検証しない。
create temp table da_boundary_61 as
select pg_temp.call_as(pg_temp.uid('T'), jsonb_build_object('amr', jsonb_build_array(pg_temp.amr('password', 61)))) as r;
create temp table da_boundary_exists as select exists (select 1 from auth.users where id = pg_temp.uid('T')) as e;
create temp table da_boundary_59 as
select pg_temp.call_as(pg_temp.uid('T'), jsonb_build_object('amr', jsonb_build_array(pg_temp.amr('password', 59)))) as r;

select is(
  (select r from da_boundary_61) || ' ' || (select e::text from da_boundary_exists) || ' ' || (select r from da_boundary_59)
    || ' ' || exists (select 1 from auth.users where id = pg_temp.uid('T'))::text,
  'error:PT403 true ok false',
  'パスワードの認証が61秒前の呼び出しは拒否され、59秒前の呼び出しは成功して利用者が消える'
);

-- amrの要素の並びに依らず、新しいパスワードの認証があれば成功する。
create temp table da_order as
select pg_temp.call_as(pg_temp.uid('O1'), jsonb_build_object('amr', jsonb_build_array(pg_temp.amr('password', 1), pg_temp.amr('otp', 3600)))) as password_first,
       pg_temp.call_as(pg_temp.uid('O2'), jsonb_build_object('amr', jsonb_build_array(pg_temp.amr('otp', 3600), pg_temp.amr('password', 1)))) as password_last;

select results_eq(
  $$select password_first, password_last from da_order$$,
  $$values ('ok'::text, 'ok'::text)$$,
  '古い認証コードの要素があっても、パスワードの認証が新しければ、並びに依らず成功する'
);

-- 冪等性: 成功の後の再呼び出し(削除済みのアカウントの旧トークン)は、鮮度が満たされていても拒否される。
select is(
  pg_temp.call_as(pg_temp.uid('T'), pg_temp.fresh()),
  'error:PT403',
  '成功の後に同じ利用者のJWTで再び呼ぶと、アカウントが無いためPT403で拒否される'
);

-- ============================================================
-- A5 原子性と関数の属性
-- ============================================================

-- 最後のauth.usersの削除が失敗する状況を、public.usersの削除の前に例外を出すトリガーで作る(テストの終わりのロールバックで消える)。
create function pg_temp.fail_user_delete() returns trigger
language plpgsql
as $$
begin
  if old.id = pg_temp.uid('X') then
    raise exception '試験用の失敗' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
create trigger da_fail_user_delete before delete on public.users for each row execute function pg_temp.fail_user_delete();

create temp table da_before_atomic as select pg_temp.snapshot() as snap;
create temp table da_atomic as select pg_temp.call_as(pg_temp.uid('X'), pg_temp.fresh()) as r;

select is(
  (select r from da_atomic),
  'error:P0001',
  '削除の最後の段階で例外が起きると、呼び出しは失敗として返る'
);

select is(
  pg_temp.snapshot(),
  (select snap from da_before_atomic),
  '途中の例外では、匿名化と削除の全てが取り消され、一部だけが残らない'
);

drop trigger da_fail_user_delete on public.users;

select is(
  (select proconfig from pg_proc where oid = 'public.delete_account()'::regprocedure),
  array['search_path=""', 'statement_timeout=60s'],
  '関数は検索パスを空にし、制限時間を60秒にする'
);

select ok(
  (select prosecdef from pg_proc where oid = 'public.delete_account()'::regprocedure),
  '関数はSECURITY DEFINERである'
);

-- ============================================================
-- A2 削除の副作用
-- ============================================================

create temp table da_s_call as select pg_temp.call_as(pg_temp.uid('S'), pg_temp.fresh()) as r;

select is((select r from da_s_call), 'ok', '編集者が自分だけのラウンドを持つ利用者が、削除できる');

select is_empty(
  $$select 'rounds' as t from public.rounds where id in (select pg_temp.uid(a) from unnest(array['S1','S2','S3','S4']) a)
    union all select 'distances' from public.distances where round_id in (select pg_temp.uid(a) from unnest(array['S1','S2','S3','S4']) a)
    union all select 'shots' from public.shots where distance_id in (select pg_temp.uid(a || '.d') from unnest(array['S1','S2','S3','S4']) a)
    union all select 'shot_events' from public.shot_events where distance_id in (select pg_temp.uid(a || '.d') from unnest(array['S1','S2','S3','S4']) a)
    union all select 'distance_events' from public.distance_events where round_id in (select pg_temp.uid(a) from unnest(array['S1','S2','S3','S4']) a)
    union all select 'round_events' from public.round_events where round_id in (select pg_temp.uid(a) from unnest(array['S1','S2','S3','S4']) a)
    union all select 'round_users' from public.round_users where round_id in (select pg_temp.uid(a) from unnest(array['S1','S2','S3','S4']) a)$$,
  '他に編集者がいないラウンドは、進行中・完了・論理削除済み・閲覧者だけが残るもののどれも、距離・矢・全ての履歴・参加を含めて消える'
);

select is_empty(
  $$select 'users' from public.users where id = pg_temp.uid('S')
    union all select 'auth.users' from auth.users where id = pg_temp.uid('S')
    union all select 'sessions' from auth.sessions where user_id = pg_temp.uid('S')
    union all select 'refresh_tokens' from auth.refresh_tokens where user_id = pg_temp.uid('S')::text
    union all select 'identities' from auth.identities where user_id = pg_temp.uid('S')
    union all select 'preset_rounds' from public.preset_rounds where owner_id = pg_temp.uid('S')
    union all select 'preset_distances' from public.preset_distances where preset_id = pg_temp.uid('Sp')$$,
  '利用者のプロフィール、個人のプリセットとその距離、認証の利用者・セッション・リフレッシュトークン・identitiesが消える'
);

select results_eq(
  $$select (select count(*) from public.round_users where user_id = pg_temp.uid('W')), (select count(*) from public.users where id = pg_temp.uid('W'))$$,
  $$values (1::bigint, 1::bigint)$$,
  '他の利用者(閲覧者だったW)は、閲覧者の参加だけが消え、自分のラウンドの参加とプロフィールは残る'
);

select is(
  (select count(*) from public.shots where distance_id = pg_temp.uid('W1.d')),
  1::bigint,
  '他の利用者のラウンドの矢は残る'
);

select is(
  pg_temp.leftover_refs(pg_temp.uid('S')),
  0::bigint,
  '利用者のIDを値に持つ行が、利用者を指す全ての外部キーの列で0件になる'
);

-- 利用者を指す外部キーの列の一覧。新しい外部キーが増えたら、この表と、匿名化・削除の対象を見直す。認証サービスが管理するスキーマの表は、版で変わるため比べない(0件の確認が漏れを見る)。
select results_eq(
  $$select (c.conrelid::regclass::text || '.' || a.attname::text) collate "C" as ref
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid in ('public.users'::regclass, 'auth.users'::regclass)
      and c.connamespace = 'public'::regnamespace
    order by 1$$,
  $$values
    ('distance_events.author_id'::text collate "C"), ('preset_rounds.owner_id'), ('round_events.author_id'), ('round_users.user_id'),
    ('shot_events.author_id'), ('shot_events.shooter_id'), ('shots.shooter_id'), ('users.id')$$,
  'publicで利用者を指す外部キーの列が、削除と匿名化で扱う列の一覧と全件一致する'
);

-- ============================================================
-- A3 匿名化
-- ============================================================

create temp table da_a_call as select pg_temp.call_as(pg_temp.uid('A'), pg_temp.fresh()) as r;

select is((select r from da_a_call), 'ok', '他の編集者が残るラウンドに矢と履歴を持つ利用者が、削除できる');

select results_eq(
  $$select id, distance_id, end_number, shooter_id, score_str, score_int, revision, disabled_at, shot_number, created_at
    from public.shots where distance_id in (select pg_temp.uid(a || '.d') from unnest(array['R1','R2','R3']) a) order by id$$,
  $$select id, distance_id, end_number,
      case when shooter_id = pg_temp.uid('A') then pg_temp.deleted_user() else shooter_id end,
      score_str, score_int, revision, disabled_at, shot_number, created_at
    from bef_shots where distance_id in (select pg_temp.uid(a || '.d') from unnest(array['R1','R2','R3']) a) order by id$$,
  '利用者が射手の矢は残り、射手だけが削除済みの利用者になり、点数・射順・revisionなどは変わらない'
);

select results_eq(
  $$select event_id, distance_id, shot_id, type, author_id, revision, end_number, shooter_id, score_str, score_int, shot_number, set_fields, created_at
    from public.shot_events where distance_id in (select pg_temp.uid(a || '.d') from unnest(array['R1','R2','R3']) a) order by event_id$$,
  $$select event_id, distance_id, shot_id, type,
      case when author_id = pg_temp.uid('A') then pg_temp.deleted_user() else author_id end,
      revision, end_number,
      case when shooter_id = pg_temp.uid('A') then pg_temp.deleted_user() else shooter_id end,
      score_str, score_int, shot_number, set_fields, created_at
    from bef_shot_events where distance_id in (select pg_temp.uid(a || '.d') from unnest(array['R1','R2','R3']) a) order by event_id$$,
  '矢の変更履歴は、射手と操作者の両方が削除済みの利用者になり、操作の種類と前後の値は変わらない'
);

select results_eq(
  $$select event_id, round_id, distance_id, type, author_id, revision, position_key, distance, is_marked, total_ends, arrows_per_end, target_face_id, set_fields, created_at
    from public.distance_events where round_id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3']) a) order by event_id$$,
  $$select event_id, round_id, distance_id, type,
      case when author_id = pg_temp.uid('A') then pg_temp.deleted_user() else author_id end,
      revision, position_key, distance, is_marked, total_ends, arrows_per_end, target_face_id, set_fields, created_at
    from bef_distance_events where round_id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3']) a) order by event_id$$,
  '距離の履歴は、利用者が操作者のものだけが削除済みの利用者になり、他の参加者が操作した履歴は変わらない'
);

select results_eq(
  $$select event_id, round_id, type, author_id, revision, name, round_date, format, bow_type, status, set_fields, created_at
    from public.round_events where round_id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3']) a) order by event_id$$,
  $$select event_id, round_id, type,
      case when author_id = pg_temp.uid('A') then pg_temp.deleted_user() else author_id end,
      revision, name, round_date, format, bow_type, status, set_fields, created_at
    from bef_round_events where round_id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3']) a) order by event_id$$,
  'ラウンドの履歴は、利用者が操作者のものだけが削除済みの利用者になり、他の参加者が操作した履歴は変わらない'
);

select results_eq(
  $$select r.id, r.name, r.round_date, r.format, r.bow_type, r.status, r.revision, r.disabled_at, r.created_at,
      d.id, d.round_id, d.position_key, d.distance, d.total_ends, d.arrows_per_end, d.target_face_id, d.is_marked, d.revision, d.disabled_at
    from public.rounds r join public.distances d on d.round_id = r.id
    where r.id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3']) a) order by r.id$$,
  $$select r.id, r.name, r.round_date, r.format, r.bow_type, r.status, r.revision, r.disabled_at, r.created_at,
      d.id, d.round_id, d.position_key, d.distance, d.total_ends, d.arrows_per_end, d.target_face_id, d.is_marked, d.revision, d.disabled_at
    from bef_rounds r join bef_distances d on d.round_id = r.id
    where r.id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3']) a) order by r.id$$,
  '他の編集者が残るラウンドとその距離は、変わらない(行の更新日時を除く)'
);

select results_eq(
  $$select round_id, user_id, role from public.round_users where round_id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3']) a) order by round_id, user_id$$,
  $$select round_id, user_id, role from bef_round_users
    where round_id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3']) a) and user_id <> pg_temp.uid('A') order by round_id, user_id$$,
  '利用者の参加だけが消え、他の参加者の参加は変わらない(閲覧者だけだったラウンドも、ラウンドは残る)'
);

select is(
  pg_temp.leftover_refs(pg_temp.uid('A')),
  0::bigint,
  '参加していないラウンドに残った行を含め、利用者のIDを値に持つ行が、利用者を指す全ての外部キーの列で0件になる'
);

select ok(
  exists (select 1 from auth.users where id = pg_temp.deleted_user() and banned_until = 'infinity' and email is null)
    and exists (select 1 from public.users where id = pg_temp.deleted_user()),
  '匿名化の置き先は、サインインできない(無期限に禁止、メールなし)利用者として、認証とプロフィールの両方に存在する'
);

select ok(
  (select name is distinct from 'Alice Archer' from public.users where id = pg_temp.deleted_user())
    and not exists (select 1 from auth.users where email = 'alice@example.test'),
  '匿名化されたデータの置き先から、削除した利用者の名前とメールアドレスは引けない'
);

-- 匿名化の後も、残る参加者の取得と書き込みが成り立つ。
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid('B'), 'role', 'authenticated')::text, true);

select ok(
  (select count(*) = 3 from jsonb_array_elements(public.rounds_list(null, null, null, null, null, 100) -> 'rounds') as e(r)
    where (e.r ->> 'id')::uuid in (pg_temp.uid('R1'), pg_temp.uid('R2'), pg_temp.uid('R3'))),
  '残る編集者は、匿名化されたラウンドを履歴の取得で削除前と同じように読める'
);

select ok(
  (select count(*) = 3 from public.history_rounds(null, null, null, null, null) h
    where h.id in (pg_temp.uid('R1'), pg_temp.uid('R2'), pg_temp.uid('R3'))),
  '残る編集者は、匿名化されたラウンドを履歴のラウンドの取得で読める'
);

select is(
  (select (public.record_shots(jsonb_build_array(jsonb_build_object(
    'shot_event_id', pg_temp.uid('new.se'), 'shot_id', pg_temp.uid('new.s'), 'distance_id', pg_temp.uid('R1.d'),
    'end_number', 2, 'score_str', '10', 'score_int', 10)))) -> 0 ->> 'applied'),
  'true',
  '残る編集者は、匿名化されたラウンドに矢を記録できる'
);

reset role;

-- ============================================================
-- A4 再登録と旧トークン
-- ============================================================

insert into auth.users (id, email) values (pg_temp.uid('A2'), 'alice@example.test');

select ok(
  pg_temp.uid('A2') <> pg_temp.uid('A')
    and exists (select 1 from public.users where id = pg_temp.uid('A2'))
    and not exists (select 1 from public.round_users where user_id = pg_temp.uid('A2'))
    and not exists (select 1 from public.shots where shooter_id = pg_temp.uid('A2')),
  '削除したメールアドレスで新しく登録でき、新しい利用者は旧データを引き継がない'
);

-- 旧IDのJWT(期限内)での書き込みと読み取り。
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid('A'), 'role', 'authenticated')::text, true);

select throws_ok(
  $$select public.record_shots(jsonb_build_array(jsonb_build_object(
    'shot_event_id', pg_temp.uid('old.se'), 'shot_id', pg_temp.uid('old.s'), 'distance_id', pg_temp.uid('R1.d'),
    'end_number', 3, 'score_str', '9', 'score_int', 9)))$$,
  'PT403',
  null,
  '旧IDのJWTでの矢の記録は、参加の確認でPT403になる'
);

select throws_ok(
  $$select public.save_round_as_preset('旧トークンのプリセット', 'outdoor', 'recurve',
    jsonb_build_array(jsonb_build_object('position_key', 'a', 'distance', 70, 'is_marked', true, 'total_ends', 12, 'arrows_per_end', 3, 'target_face_id', pg_temp.face())))$$,
  '23503',
  null,
  '旧IDのJWTでのプリセットの保存は、利用者の行を参照する外部キーで失敗する'
);

select is(
  (select count(*) from public.rounds) + (select count(*) from public.shots) + (select count(*) from public.preset_rounds where owner_id = pg_temp.uid('A')),
  0::bigint,
  '旧IDのJWTでは、ラウンド・矢・自分のプリセットが読めない'
);

select ok(
  (select count(*) > 0 from public.target_faces),
  '旧IDのJWTでも、全員が読める共有データの的は読める'
);

reset role;

select is(
  (select count(*) from public.preset_rounds where name = '旧トークンのプリセット'),
  0::bigint,
  '旧IDのJWTの書き込みで、行は増えない'
);

select * from finish();

rollback;
