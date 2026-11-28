-- アカウント削除(delete_account)の振る舞いを確認する。
--   - 認可: 認証済みで、JWTのamrにotpの認証が直近60秒以内にあること。満たさない呼び出しは何も変えずにPT403で拒否する
--   - 削除: 他に射つ人がいないラウンドは全ての状態で消え、利用者のプロフィール・参加・個人のプリセット・認証の行も消える
--   - 匿名化: 他の射つ人が残るラウンドの矢・履歴は残り、利用者の射手は番号を保って紐づけと役割を外し、操作者だけが「削除済みの利用者」に置き換わる
--   - 再登録と旧トークン、原子性、関数の属性
--   - 削除の記録(docs/backup.md): 記録先の設定が無い・記録を送れないときの取り消しと、復元で使うpurge_account
-- 権限(anonとauthenticatedのEXECUTE)は rls_matrix.sql の関数EXECUTE表が固定する。
-- 同時の削除は、複数の接続が要るためapps/web/tests/e2e/auth/delete-account.spec.tsで確かめる。
-- ラウンドの形は実際のデータに合わせ、屋外の12エンド×3射の距離を1つ持つ。

begin;

select plan(59);

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

-- ラウンドと、12エンド×3射の距離を1つ作る。作成者を射手1の射つ人とし、作成の履歴を残す。
create function pg_temp.mk_round(p_alias text, p_author text, p_status text default 'in_progress', p_disabled boolean default false) returns void
language plpgsql
as $$
begin
  insert into public.rounds (id, name, round_date, format, bow_type, status, disabled_at)
  values (pg_temp.uid(p_alias), p_alias, '2026-09-10', 'outdoor', 'recurve', p_status, case when p_disabled then now() end);
  insert into public.round_users (round_id, user_id, role, shooter_number) values (pg_temp.uid(p_alias), pg_temp.uid(p_author), 'owner', 1);
  insert into public.round_events (event_id, round_id, type, author_id, revision, name, round_date, format, bow_type, status)
  values (pg_temp.uid(p_alias || '.re1'), pg_temp.uid(p_alias), 'CREATED', pg_temp.uid(p_author), 1, p_alias, '2026-09-10', 'outdoor', 'recurve', p_status);
  insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked)
  values (pg_temp.uid(p_alias || '.d'), pg_temp.uid(p_alias), 'a', 70, 12, 3, pg_temp.face(), true);
  insert into public.distance_events (event_id, round_id, distance_id, type, author_id, revision, position_key, distance, is_marked, total_ends, arrows_per_end, target_face_id)
  values (pg_temp.uid(p_alias || '.de1'), pg_temp.uid(p_alias), pg_temp.uid(p_alias || '.d'), 'CREATED', pg_temp.uid(p_author), 1, 'a', 70, true, 12, 3, pg_temp.face());
end;
$$;

-- 射つ人(番号あり)か代理の人(番号なし)を加える。
create function pg_temp.join_round(p_round text, p_user text, p_role text, p_number int default null) returns void
language sql
as $$ insert into public.round_users (round_id, user_id, role, shooter_number) values (pg_temp.uid(p_round), pg_temp.uid(p_user), p_role, p_number) $$;

-- 利用者に紐づかない射手を加える。
create function pg_temp.add_shooter(p_round text, p_number int) returns void
language sql
as $$ insert into public.round_users (round_id, shooter_number) values (pg_temp.uid(p_round), p_number) $$;

-- 距離に、1エンド目の矢と、その記録の履歴を足す。p_shooterが射手の番号、p_authorが記録した操作者。
create function pg_temp.mk_shot(p_round text, p_n int, p_shooter int, p_author text) returns void
language plpgsql
as $$
begin
  insert into public.shots (round_id, distance_id, end_number, shot_number, shooter_number, score_str, score_int)
  values (pg_temp.uid(p_round), pg_temp.uid(p_round || '.d'), 1, p_n, p_shooter, '9', 9);
  insert into public.shot_events (event_id, round_id, distance_id, type, author_id, revision, end_number, shooter_number, score_str, score_int, shot_number, set_fields)
  values (pg_temp.uid(p_round || '.se' || p_n), pg_temp.uid(p_round), pg_temp.uid(p_round || '.d'), 'RECORDED', pg_temp.uid(p_author), 1, 1,
    p_shooter, '9', 9, p_n, array['score', 'shooter_number']);
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
-- S: 他に射つ人がいないラウンドを持つ(Wが代理の人)。A: 他の射つ人Bが残るラウンドを持つ(Vが代理の人)。
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
select pg_temp.mk_shot('Q1', 1, 1, 'Q');
select pg_temp.mk_preset('Qp', 'Q');
select pg_temp.mk_auth_rows('Q');

-- X: 自分だけのラウンドと、他の射つ人が残るラウンド。
select pg_temp.mk_round('X1', 'X');
select pg_temp.mk_shot('X1', 1, 1, 'X');
select pg_temp.mk_round('X2', 'B');
select pg_temp.join_round('X2', 'X', 'owner', 2);
select pg_temp.mk_shot('X2', 1, 2, 'X');

-- S: 進行中・完了・論理削除済みの自分だけのラウンドと、代理の人Wと紐づかない射手が残るラウンド。
select pg_temp.mk_round('S1', 'S', 'in_progress');
select pg_temp.mk_round('S2', 'S', 'completed');
select pg_temp.mk_round('S3', 'S', 'completed', true);
select pg_temp.mk_round('S4', 'S', 'in_progress');
select pg_temp.join_round('S4', 'W', 'editor');
select pg_temp.add_shooter('S4', 3);
select pg_temp.mk_shot(r, 1, 1, 'S') from unnest(array['S1', 'S2', 'S3', 'S4']) as r;
select pg_temp.mk_shot(r, 2, 1, 'S') from unnest(array['S1', 'S2', 'S3']) as r;
select pg_temp.mk_shot('S4', 2, 3, 'W');
select pg_temp.mk_edit(r, 'S') from unnest(array['S1', 'S2', 'S3', 'S4']) as r;
select pg_temp.mk_preset('Sp', 'S');
select pg_temp.mk_auth_rows('S');
-- Wは自分だけのラウンドも持つ(削除の影響を受けない)。
select pg_temp.mk_round('W1', 'W');
select pg_temp.mk_shot('W1', 1, 1, 'W');
select pg_temp.mk_preset('Wp', 'W');

-- A: 他の射つ人Bが残るラウンドR1(Vは代理の人、射手4は紐づかない)、Aが代理の人のラウンドR2、
--    Aが参加していないラウンドR3、Aが矢を1本も記録していない射手のラウンドR4。
--   R1の矢: 1=射手A(1)・記録A、2=射手A(1)・記録B、3=射手B(2)・記録A、4=射手B(2)・記録B、5=射手4・記録V
--   R2の矢は代理の人Aが記録した射手Bの矢。R3は各履歴の操作者にAが残った形。
select pg_temp.mk_round('R1', 'A', 'completed');
select pg_temp.join_round('R1', 'B', 'owner', 2);
select pg_temp.join_round('R1', 'V', 'editor');
select pg_temp.add_shooter('R1', 4);
select pg_temp.mk_shot('R1', 1, 1, 'A');
select pg_temp.mk_shot('R1', 2, 1, 'B');
select pg_temp.mk_shot('R1', 3, 2, 'A');
select pg_temp.mk_shot('R1', 4, 2, 'B');
select pg_temp.mk_shot('R1', 5, 4, 'V');
select pg_temp.mk_edit('R1', 'A');
select pg_temp.mk_edit('R1', 'B');
select pg_temp.mk_round('R2', 'B', 'completed');
select pg_temp.join_round('R2', 'A', 'editor');
select pg_temp.mk_shot('R2', 1, 1, 'A');
select pg_temp.mk_shot('R2', 2, 1, 'B');
select pg_temp.mk_round('R3', 'B', 'completed');
select pg_temp.mk_shot('R3', 1, 1, 'A');
select pg_temp.mk_shot('R3', 2, 1, 'B');
select pg_temp.mk_edit('R3', 'A');
select pg_temp.mk_round('R4', 'B', 'in_progress');
select pg_temp.join_round('R4', 'A', 'owner', 3);
select pg_temp.mk_shot('R4', 1, 1, 'B');
select pg_temp.mk_preset('Ap', 'A');
select pg_temp.mk_auth_rows('A');

-- G: Googleだけで作った確認済みの利用者(メールの手段なし。メールの手段を残すトリガーの対象外の形)。
select pg_temp.mk_user('G', 'google-only@example.test');
update auth.users set email_confirmed_at = now() where id = pg_temp.uid('G');
insert into auth.identities (provider_id, user_id, identity_data, provider)
values ('google-sub-G', pg_temp.uid('G'), jsonb_build_object('sub', 'google-sub-G', 'email', 'google-only@example.test'), 'google');

-- ---- 呼び出しと測定の補助 ----

-- authenticatedまたはanonとして、JWTのクレームを設定して呼び、結果を 'ok' か 'error:<SQLSTATE>' で返す。
create function pg_temp.call_as(p_uid uuid, p_claims jsonb default '{}', p_role text default 'authenticated', p_expected text default 'self') returns text
language plpgsql
as $$
declare
  v_result text;
begin
  perform set_config('request.jwt.claims', (jsonb_build_object('sub', p_uid, 'role', p_role) || p_claims)::text, true);
  execute format('set local role %I', p_role);
  begin
    perform public.delete_account(case when p_expected = 'self' then p_uid else p_expected::uuid end);
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
language sql volatile
as $$ select jsonb_build_object('method', p_method, 'timestamp', extract(epoch from clock_timestamp()) - p_seconds) $$;

create function pg_temp.fresh() returns jsonb
language sql volatile
as $$ select jsonb_build_object('amr', jsonb_build_array(pg_temp.amr('otp', 1))) $$;

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

create temp table da_reject (label text primary key, uid uuid, role text not null, claims jsonb not null, expected text not null, expected_id text default 'self');
insert into da_reject (label, uid, role, claims, expected) values
  ('認証されていない(auth.uid()が無い)', null, 'authenticated', pg_temp.fresh(), 'error:PT403'),
  ('anonロールにはEXECUTE権限が無い', null, 'anon', pg_temp.fresh(), 'error:42501'),
  ('amrが無い', pg_temp.uid('Q'), 'authenticated', '{}', 'error:PT403'),
  ('amrが空の配列', pg_temp.uid('Q'), 'authenticated', '{"amr":[]}', 'error:PT403'),
  ('amrが配列でない', pg_temp.uid('Q'), 'authenticated', '{"amr":{"method":"otp"}}', 'error:PT403'),
  ('passwordだけでは認可しない', pg_temp.uid('Q'), 'authenticated',
    jsonb_build_object('amr', jsonb_build_array(pg_temp.amr('password', 1))), 'error:PT403'),
  ('古いOTPは認可しない', pg_temp.uid('Q'), 'authenticated',
    jsonb_build_object('amr', jsonb_build_array(pg_temp.amr('otp', 61))), 'error:PT403'),
  ('refreshだけでは認可しない', pg_temp.uid('Q'), 'authenticated',
    jsonb_build_object('amr', jsonb_build_array(pg_temp.amr('token_refresh', 1))), 'error:PT403'),
  ('未来のOTPは認可しない', pg_temp.uid('Q'), 'authenticated',
    jsonb_build_object('amr', jsonb_build_array(pg_temp.amr('otp', -1))), 'error:PT403'),
  ('文字列のtimestampは認可しない', pg_temp.uid('Q'), 'authenticated',
    '{"amr":[{"method":"otp","timestamp":"123456"}]}', 'error:PT403'),
  ('nullのtimestampは認可しない', pg_temp.uid('Q'), 'authenticated',
    '{"amr":[{"method":"otp","timestamp":null}]}', 'error:PT403'),
  ('欠落のtimestampは認可しない', pg_temp.uid('Q'), 'authenticated',
    '{"amr":[{"method":"otp"}]}', 'error:PT403'),
  ('amrがnull', pg_temp.uid('Q'), 'authenticated', '{"amr":null}', 'error:PT403'),
  ('削除済みの利用者のID(鮮度は満たす)', pg_temp.deleted_user(), 'authenticated', pg_temp.fresh(), 'error:PT403'),
  ('存在しない利用者のID(鮮度は満たす)', pg_temp.uid('nobody'), 'authenticated', pg_temp.fresh(), 'error:PT403');

insert into da_reject(label, uid, role, claims, expected, expected_id) values
 ('対象IDが別人', pg_temp.uid('Q'), 'authenticated', pg_temp.fresh(), 'error:PT403', pg_temp.uid('S')::text),
 ('対象IDがnull', pg_temp.uid('Q'), 'authenticated', pg_temp.fresh(), 'error:PT403', null);
insert into da_reject(label, uid, role, claims, expected) values
 ('真偽値のtimestamp', pg_temp.uid('Q'), 'authenticated', '{"amr":[{"method":"otp","timestamp":true}]}', 'error:PT403'),
 ('要素が数値', pg_temp.uid('Q'), 'authenticated', '{"amr":[1]}', 'error:PT403'),
 ('古いOTPと新しいpassword', pg_temp.uid('Q'), 'authenticated', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr('otp',61),pg_temp.amr('password',1))), 'error:PT403'),
 ('methodが異なる', pg_temp.uid('Q'), 'authenticated', '{"amr":[{"method":"email_change","timestamp":1}]}', 'error:PT403'),
 ('数値の範囲外に相当する未来時刻', pg_temp.uid('Q'), 'authenticated', '{"amr":[{"method":"otp","timestamp":1e1000}]}', 'error:PT403'),
 ('amrの要素がnull', pg_temp.uid('Q'), 'authenticated', '{"amr":[null]}', 'error:PT403'),
 ('iatだけが新しい', pg_temp.uid('Q'), 'authenticated', jsonb_build_object('iat',extract(epoch from clock_timestamp())), 'error:PT403');

create temp table da_before as select pg_temp.snapshot() as snap;
create temp table da_reject_result as
select label, pg_temp.call_as(uid, claims, role, expected_id) as actual, expected from da_reject;

select is_empty(
  $$select label, actual, expected from da_reject_result where actual is distinct from expected$$,
  '認可を満たさない呼び出しは、権限の拒否(42501)とPT403を区別して、全て拒否される'
);

select is(
  pg_temp.snapshot(),
  (select snap from da_before),
  '拒否された呼び出しの後、利用者・ラウンド・矢・履歴・参加・プリセット・認証の行が呼び出し前と同一である'
);

-- 実時計の近傍(61秒前・59秒前)。厳密な等号と小数秒の境界は別途固定時計での確認が必要。
create temp table da_boundary_61 as
select pg_temp.call_as(pg_temp.uid('T'), jsonb_build_object('amr', jsonb_build_array(pg_temp.amr('otp', 61)))) as r;
create temp table da_boundary_exists as select exists (select 1 from auth.users where id = pg_temp.uid('T')) as e;
create temp table da_boundary_59 as
select pg_temp.call_as(pg_temp.uid('T'), jsonb_build_object('amr', jsonb_build_array(pg_temp.amr('otp', 59)))) as r;

select is(
  (select r from da_boundary_61) || ' ' || (select e::text from da_boundary_exists) || ' ' || (select r from da_boundary_59)
    || ' ' || exists (select 1 from auth.users where id = pg_temp.uid('T'))::text,
  'error:PT403 true ok false',
  'OTPの認証が61秒前の呼び出しは拒否され、59秒前の呼び出しは成功して利用者が消える'
);

-- amrの要素の並びに依らず、新しいOTPの認証があれば成功する。
create temp table da_order as
select pg_temp.call_as(pg_temp.uid('O1'), jsonb_build_object('amr', jsonb_build_array(pg_temp.amr('otp', 1), pg_temp.amr('password', 3600)))) as otp_first,
       pg_temp.call_as(pg_temp.uid('O2'), jsonb_build_object('amr', jsonb_build_array(pg_temp.amr('password', 3600), pg_temp.amr('otp', 1)))) as otp_last;

select results_eq(
  $$select otp_first, otp_last from da_order$$,
  $$values ('ok'::text, 'ok'::text)$$,
  '古い認証コードの要素があっても、OTPの認証が新しければ、並びに依らず成功する'
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

-- ============================================================
-- A2 削除の副作用
-- ============================================================

create temp table da_s_call as select pg_temp.call_as(pg_temp.uid('S'), pg_temp.fresh()) as r;

select is((select r from da_s_call), 'ok', '自分だけが射つ人のラウンドを持つ利用者が、削除できる');

select is_empty(
  $$select 'rounds' as t from public.rounds where id in (select pg_temp.uid(a) from unnest(array['S1','S2','S3','S4']) a)
    union all select 'distances' from public.distances where round_id in (select pg_temp.uid(a) from unnest(array['S1','S2','S3','S4']) a)
    union all select 'shots' from public.shots where round_id in (select pg_temp.uid(a) from unnest(array['S1','S2','S3','S4']) a)
    union all select 'shot_events' from public.shot_events where round_id in (select pg_temp.uid(a) from unnest(array['S1','S2','S3','S4']) a)
    union all select 'distance_events' from public.distance_events where round_id in (select pg_temp.uid(a) from unnest(array['S1','S2','S3','S4']) a)
    union all select 'round_events' from public.round_events where round_id in (select pg_temp.uid(a) from unnest(array['S1','S2','S3','S4']) a)
    union all select 'round_users' from public.round_users where round_id in (select pg_temp.uid(a) from unnest(array['S1','S2','S3','S4']) a)$$,
  '他に射つ人がいないラウンドは、進行中・完了・論理削除済み・代理の人と紐づかない射手が残るもののどれも、距離・矢・射手・全ての履歴を含めて消える'
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
  '他の利用者(代理の人だったW)は、消えたラウンドの参加だけがなくなり、自分のラウンドの参加とプロフィールは残る'
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

-- Googleだけの利用者は、OTPの認証で削除でき、Googleの手段も消える。
create temp table da_g_call as select pg_temp.call_as(pg_temp.uid('G'), pg_temp.fresh()) as r;

select is((select r from da_g_call), 'ok', 'Googleだけで作った確認済みの利用者が、OTPの認証で削除できる(メールの手段を残すトリガーに妨げられない)');

select is_empty(
  $$select 'auth.users' from auth.users where id = pg_temp.uid('G')
    union all select 'identities' from auth.identities where user_id = pg_temp.uid('G')
    union all select 'users' from public.users where id = pg_temp.uid('G')$$,
  'Googleだけの利用者の認証の行(Googleの手段を含む)とプロフィールが消える'
);

-- ============================================================
-- A3 匿名化
-- ============================================================

-- 残る射つ人Bから見た、一覧と詳細の集計。
create function pg_temp.summary_as(p_uid uuid) returns jsonb
language plpgsql
as $$
declare
  v_result jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select jsonb_build_object(
    'rounds', public.rounds_list(null, null, null, null, null, 100),
    'distances', public.distances_list(null, null, null, null, null, 100),
    'details', (
      select jsonb_agg(to_jsonb(t) order by t.distance_id, t.shooter_number)
      from (
        select s.distance_id, s.shooter_number, count(*) as arrows, sum(s.score_int) as total
        from public.shots s
        where s.round_id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3','R4']) a) and s.disabled_at is null
        group by s.distance_id, s.shooter_number
      ) as t
    )
  ) into v_result;
  reset role;
  return v_result;
end;
$$;

create temp table da_summary_before as select pg_temp.summary_as(pg_temp.uid('B')) as v;

create temp table da_a_call as select pg_temp.call_as(pg_temp.uid('A'), pg_temp.fresh()) as r;

select is((select r from da_a_call), 'ok', '他の射つ人が残るラウンドに射手・矢・履歴を持つ利用者が、削除できる');

select results_eq(
  $$select round_id, distance_id, end_number, shot_number, shooter_number, score_str, score_int, revision, disabled_at, created_at
    from public.shots where round_id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3','R4']) a) order by distance_id, end_number, shot_number$$,
  $$select round_id, distance_id, end_number, shot_number, shooter_number, score_str, score_int, revision, disabled_at, created_at
    from bef_shots where round_id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3','R4']) a) order by distance_id, end_number, shot_number$$,
  '他の射つ人が残るラウンドの矢は残り、射手・点数・マスの番号・revisionは変わらない(代理の人が記録した矢を含む)'
);

select results_eq(
  $$select event_id, round_id, distance_id, type, author_id, revision, end_number, shooter_number, score_str, score_int, shot_number, set_fields, created_at
    from public.shot_events where round_id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3','R4']) a) order by event_id$$,
  $$select event_id, round_id, distance_id, type,
      case when author_id = pg_temp.uid('A') then pg_temp.deleted_user() else author_id end,
      revision, end_number, shooter_number, score_str, score_int, shot_number, set_fields, created_at
    from bef_shot_events where round_id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3','R4']) a) order by event_id$$,
  '矢の変更履歴は、操作者だけが削除済みの利用者になり、射手・操作の種類・前後の値は変わらない'
);

select results_eq(
  $$select event_id, round_id, distance_id, type, author_id, revision, position_key, distance, is_marked, total_ends, arrows_per_end, target_face_id, set_fields, created_at
    from public.distance_events where round_id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3','R4']) a) order by event_id$$,
  $$select event_id, round_id, distance_id, type,
      case when author_id = pg_temp.uid('A') then pg_temp.deleted_user() else author_id end,
      revision, position_key, distance, is_marked, total_ends, arrows_per_end, target_face_id, set_fields, created_at
    from bef_distance_events where round_id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3','R4']) a) order by event_id$$,
  '距離の履歴は、利用者が操作者のものだけが削除済みの利用者になり、他の参加者が操作した履歴は変わらない'
);

select results_eq(
  $$select event_id, round_id, type, author_id, revision, name, round_date, format, bow_type, status, set_fields, created_at
    from public.round_events where round_id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3','R4']) a) order by event_id$$,
  $$select event_id, round_id, type,
      case when author_id = pg_temp.uid('A') then pg_temp.deleted_user() else author_id end,
      revision, name, round_date, format, bow_type, status, set_fields, created_at
    from bef_round_events where round_id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3','R4']) a) order by event_id$$,
  'ラウンドの履歴は、利用者が操作者のものだけが削除済みの利用者になり、他の参加者が操作した履歴は変わらない'
);

select results_eq(
  $$select r.id, r.name, r.round_date, r.format, r.bow_type, r.status, r.revision, r.disabled_at, r.created_at,
      d.id, d.round_id, d.position_key, d.distance, d.total_ends, d.arrows_per_end, d.target_face_id, d.is_marked, d.revision, d.disabled_at
    from public.rounds r join public.distances d on d.round_id = r.id
    where r.id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3','R4']) a) order by r.id$$,
  $$select r.id, r.name, r.round_date, r.format, r.bow_type, r.status, r.revision, r.disabled_at, r.created_at,
      d.id, d.round_id, d.position_key, d.distance, d.total_ends, d.arrows_per_end, d.target_face_id, d.is_marked, d.revision, d.disabled_at
    from bef_rounds r join bef_distances d on d.round_id = r.id
    where r.id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3','R4']) a) order by r.id$$,
  '他の射つ人が残るラウンドとその距離は、変わらない(行の更新日時を除く)'
);

-- 射つ人Aの行(R1の射手1、矢の無いR4の射手3)は行のIDと番号を保って紐づけと役割が外れ、代理の人の行(R2)は消える。
select results_eq(
  $$select id, round_id, user_id, role, shooter_number, created_at
    from public.round_users where round_id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3','R4']) a) order by id$$,
  $$select id, round_id,
      case when user_id = pg_temp.uid('A') then null else user_id end,
      case when user_id = pg_temp.uid('A') then null else role end,
      shooter_number, created_at
    from bef_round_users
    where round_id in (select pg_temp.uid(a) from unnest(array['R1','R2','R3','R4']) a)
      and not (user_id is not distinct from pg_temp.uid('A') and shooter_number is null)
    order by id$$,
  '利用者の射手は矢の有無を問わず利用者と役割だけがNULLになり、代理の人の参加は消え、射手は増えず、他の利用者の行は変わらない'
);

select is(
  (select string_agg(r.a || ':' || u.shooter_number, ',' order by r.a, u.shooter_number)
    from unnest(array['R1','R4']) as r(a)
    join public.round_users u on u.round_id = pg_temp.uid(r.a) and u.user_id is null and u.role is null),
  'R1:1,R1:4,R4:3',
  '紐づかない射手は、匿名化した射手と元からの射手だけである'
);

select is(
  pg_temp.leftover_refs(pg_temp.uid('A')),
  0::bigint,
  '参加していないラウンドに残った行を含め、利用者のIDを値に持つ行が、利用者を指す全ての外部キーの列で0件になる'
);

select is(
  (select count(*) from public.round_users where user_id = pg_temp.deleted_user()),
  0::bigint,
  '匿名化先は、どの射手の利用者にもならない'
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

select is(
  pg_temp.summary_as(pg_temp.uid('B')),
  (select v from da_summary_before),
  '残る利用者の一覧と詳細の集計は、削除の前後で同じである'
);

-- 匿名化の後も、残る参加者の取得と書き込みが成り立つ。
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid('B'), 'role', 'authenticated')::text, true);

select ok(
  (select count(*) = 3 from public.history_rounds(null, null, null, null, null) h
    where h.id in (pg_temp.uid('R1'), pg_temp.uid('R2'), pg_temp.uid('R3'))),
  '残る射つ人は、匿名化されたラウンドを履歴のラウンドの取得で読める'
);

select is(
  (select (public.record_shots(jsonb_build_array(jsonb_build_object(
    'shot_event_id', pg_temp.uid('new.se'), 'distance_id', pg_temp.uid('R1.d'),
    'end_number', 2, 'shot_number', 1, 'score_str', '10', 'score_int', 10, 'shooter_number', 1)))) -> 0 ->> 'applied'),
  'true',
  '残る射つ人は、匿名化された射手の矢を記録できる'
);

reset role;

select lives_ok(
  'set constraints all immediate',
  'アカウント削除の後に残るラウンドは、射つ人の検査を通る'
);
set constraints all deferred;

-- ============================================================
-- A4 再登録と旧トークン
-- ============================================================

insert into auth.users (id, email) values (pg_temp.uid('A2'), 'alice@example.test');

select ok(
  pg_temp.uid('A2') <> pg_temp.uid('A')
    and exists (select 1 from public.users where id = pg_temp.uid('A2'))
    and not exists (select 1 from public.round_users where user_id = pg_temp.uid('A2'))
    and not exists (select 1 from public.shot_events where author_id = pg_temp.uid('A2')),
  '削除したメールアドレスで新しく登録でき、新しい利用者は旧データを引き継がない'
);

-- 旧IDのJWT(期限内)での書き込みと読み取り。
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid('A'), 'role', 'authenticated')::text, true);

select throws_ok(
  $$select public.record_shots(jsonb_build_array(jsonb_build_object(
    'shot_event_id', pg_temp.uid('old.se'), 'distance_id', pg_temp.uid('R1.d'),
    'end_number', 3, 'shot_number', 1, 'score_str', '9', 'score_int', 9, 'shooter_number', 1)))$$,
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

-- ============================================================
-- A6 削除の記録(docs/backup.md)と、復元で使う内部関数purge_account
-- ============================================================

-- P: 自分だけのラウンドと、他の射つ人Bが残るラウンドを持つ。復元で削除の記録を適用するときと同じ入力(削除の後の状態へ戻す利用者)に使う。
select pg_temp.mk_user('P', 'pat@example.test', 'Pat Archer');
select pg_temp.mk_round('P1', 'P');
select pg_temp.mk_shot('P1', 1, 1, 'P');
select pg_temp.mk_round('P2', 'B', 'completed');
select pg_temp.join_round('P2', 'P', 'owner', 2);
select pg_temp.mk_shot('P2', 1, 2, 'P');
select pg_temp.mk_shot('P2', 2, 1, 'P');
select pg_temp.mk_edit('P2', 'P');
select pg_temp.mk_preset('Pp', 'P');
select pg_temp.mk_auth_rows('P');

-- 成功したときは'ok'、失敗したときはその文言を返す。
create function pg_temp.call_message(p_uid uuid) returns text
language plpgsql
as $$
declare
  v_result text;
begin
  perform set_config('request.jwt.claims', (jsonb_build_object('sub', p_uid, 'role', 'authenticated') || pg_temp.fresh())::text, true);
  set local role authenticated;
  begin
    perform public.delete_account(p_uid);
    v_result := 'ok';
  exception when others then
    v_result := sqlerrm;
  end;
  reset role;
  return v_result;
end;
$$;

-- 記録先(Vault)を、指定した値に置き換える。p_endpointまたはp_keyがnullなら、その秘密を置かない。
create function pg_temp.set_log_target(p_endpoint text, p_key text) returns void
language plpgsql
as $$
begin
  delete from vault.secrets where name in ('account_deletion_log_endpoint', 'account_deletion_log_key');
  if p_endpoint is not null then
    perform vault.create_secret(p_endpoint, 'account_deletion_log_endpoint');
  end if;
  if p_key is not null then
    perform vault.create_secret(p_key, 'account_deletion_log_key');
  end if;
end;
$$;

-- snapshot()から、更新日時(更新のたびに現在時刻になり、実行ごとに異なる)を除いた指紋。
create function pg_temp.snapshot_without_updated_at() returns jsonb
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
    execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) - ''updated_at'' order by (to_jsonb(t) - ''updated_at'')::text), ''[]'')::text) from %s t', v_table) into v_hash;
    v_result := v_result || jsonb_build_object(v_table, v_hash);
  end loop;
  return v_result;
end;
$$;

-- 関数を実行した後の全記録の指紋(更新日時を除く)を返し、実行は取り消す。
create function pg_temp.snapshot_after(p_kind text, p_uid uuid) returns jsonb
language plpgsql
as $$
declare
  v_snapshot jsonb;
begin
  begin
    if p_kind = 'delete' then
      if pg_temp.call_as(p_uid, pg_temp.fresh()) <> 'ok' then
        raise exception 'delete_account failed';
      end if;
    else
      perform public.purge_account(p_uid);
    end if;
    v_snapshot := pg_temp.snapshot_without_updated_at();
    raise exception 'rollback' using errcode = 'P0099';
  exception when sqlstate 'P0099' then
    null;
  end;
  return v_snapshot;
end;
$$;

-- 復元で削除の記録の適用に使うpurge_accountは、認可もWorkerへの記録も行わず、同じ利用者にdelete_accountが成功した後と同じ状態にする。
select is(
  pg_temp.snapshot_after('purge', pg_temp.uid('P')),
  pg_temp.snapshot_after('delete', pg_temp.uid('P')),
  '利用者が自分だけのラウンドと他の射つ人が残るラウンドを持つとき、purge_accountの後の全記録は、delete_accountの成功後と同一である'
);

create temp table da_before_missing as select pg_temp.snapshot() as snap;

select lives_ok(
  format('select public.purge_account(%L::uuid)', pg_temp.uid('nobody')),
  '居ない利用者へのpurge_accountは、例外にならず成功する'
);

select is(
  pg_temp.snapshot(),
  (select snap from da_before_missing),
  '居ない利用者へのpurge_accountは、何も変えない'
);

select throws_ok(
  format('select public.purge_account(%L::uuid)', pg_temp.deleted_user()),
  'P0001',
  'account_purge_forbidden',
  '匿名化の置き先(削除済みの利用者)へのpurge_accountは拒否される'
);

select throws_ok(
  'select public.purge_account(null)',
  'P0001',
  'account_purge_forbidden',
  '利用者IDがnullのpurge_accountは拒否される'
);

select lives_ok(
  format('select public.purge_account(%L::uuid)', pg_temp.uid('P')),
  '居る利用者へのpurge_accountは、利用者の認証がなくても成功する'
);

select results_eq(
  $$select (select count(*) from auth.users where id = pg_temp.uid('P')),
         (select count(*) from public.rounds where id = pg_temp.uid('P1')),
         (select count(*) from public.rounds where id = pg_temp.uid('P2')),
         (select count(*) from public.round_users where round_id = pg_temp.uid('P2') and shooter_number = 2 and user_id is null and role is null),
         (select count(*) from public.shots where distance_id = pg_temp.uid('P2.d') and shooter_number = 2),
         pg_temp.leftover_refs(pg_temp.uid('P'))$$,
  $$values (0::bigint, 0::bigint, 1::bigint, 1::bigint, 1::bigint, 0::bigint)$$,
  'purge_accountの後は、利用者と自分だけのラウンドが消え、他の射つ人が残るラウンドは残って利用者の射手が紐づかなくなり、利用者を指す行が無い'
);

create temp table da_before_twice as select pg_temp.snapshot() as snap;
select public.purge_account(pg_temp.uid('P'));

select is(
  pg_temp.snapshot(),
  (select snap from da_before_twice),
  'purge_accountを同じ利用者に再び実行しても、状態は変わらない'
);

-- 記録先の設定が無い、または記録を送れないとき、削除は全体が取り消される。
select pg_temp.mk_user('L');
select pg_temp.mk_round('L1', 'L');
select pg_temp.mk_shot('L1', 1, 1, 'L');
select pg_temp.mk_auth_rows('L');

create temp table da_log_before as select pg_temp.snapshot() as snap;

select pg_temp.set_log_target(null, null);
create temp table da_log_no_endpoint as select pg_temp.call_message(pg_temp.uid('L')) as r;
select pg_temp.set_log_target('http://127.0.0.1:1/', null);
create temp table da_log_no_key as select pg_temp.call_message(pg_temp.uid('L')) as r;
-- 127.0.0.1:1は接続を拒否し、5432はHTTPでない応答を返す。どちらもWorkerに届かない場合の再現である。
select pg_temp.set_log_target('http://127.0.0.1:1/', 'test-key');
create temp table da_log_refused as select pg_temp.call_message(pg_temp.uid('L')) as r;
select pg_temp.set_log_target('http://127.0.0.1:5432/', 'test-key');
create temp table da_log_bad_reply as select pg_temp.call_message(pg_temp.uid('L')) as r;
select pg_temp.set_log_target('disabled', null);

select results_eq(
  $$select (select r from da_log_no_endpoint), (select r from da_log_no_key)$$,
  $$values ('account_deletion_log_unconfigured'::text, 'account_deletion_log_unconfigured'::text)$$,
  '記録先の宛先または鍵の設定が無いとき、削除は設定が無いという例外で拒否される'
);

select ok(
  (select r from da_log_refused) not in ('ok', 'account_deletion_forbidden', 'otp_confirmation_required')
    and (select r from da_log_bad_reply) not in ('ok', 'account_deletion_forbidden', 'otp_confirmation_required'),
  '記録先に接続できない、またはHTTPの応答が得られないとき、削除は記録の失敗として例外になる'
);

select is(
  pg_temp.snapshot(),
  (select snap from da_log_before),
  '記録の設定が無い・記録を送れないときに拒否された削除は、削除も匿名化も残さない'
);

select is(
  pg_temp.call_message(pg_temp.uid('L')),
  'ok',
  '記録先が記録しない設定(disabled)のとき、削除は成功する'
);

-- ============================================================
-- A7 射つ人が複数いるラウンドの順の削除、利用者の変更、匿名化の内部関数
-- ============================================================

-- M: 射つ人M1(射手1)・M2(射手2)・M3(射手3)が、自分の射手の矢を持つ。N: 射つ人M1・M2だけ。
select pg_temp.mk_user(u) from unnest(array['M1', 'M2', 'M3']) as u;
select pg_temp.mk_round('M', 'M1');
select pg_temp.join_round('M', 'M2', 'owner', 2);
select pg_temp.join_round('M', 'M3', 'owner', 3);
select pg_temp.mk_shot('M', n, n, 'M' || n) from generate_series(1, 3) as n;
select pg_temp.mk_round('N', 'M1');
select pg_temp.join_round('N', 'M2', 'owner', 2);
select pg_temp.mk_shot('N', n, n, 'M' || n) from generate_series(1, 2) as n;

-- ラウンドの射手と、矢・履歴の射手番号を表す。操作者は利用者の別名か、削除済み(D)で表す。
create function pg_temp.round_state(p_round text) returns text
language sql stable
as $$
  select format('round=%s shooters=[%s] shots=[%s] authors=[%s]',
    (select count(*) from public.rounds where id = pg_temp.uid(p_round)),
    (select string_agg(u.shooter_number || ':' || coalesce(a.alias, '-'), ' ' order by u.shooter_number)
      from public.round_users u
      left join (select alias, pg_temp.uid(alias) as id from unnest(array['M1', 'M2', 'M3', 'B', 'C1', 'C2']) as alias) a on a.id = u.user_id
      where u.round_id = pg_temp.uid(p_round)),
    (select string_agg(s.shot_number || ':' || s.shooter_number, ' ' order by s.shot_number)
      from public.shots s where s.round_id = pg_temp.uid(p_round)),
    (select string_agg(e.shot_number || ':' || e.shooter_number || ':' || coalesce(a.alias, 'D'), ' ' order by e.shot_number)
      from public.shot_events e
      left join (select alias, pg_temp.uid(alias) as id from unnest(array['M1', 'M2', 'M3', 'B', 'C1', 'C2']) as alias) a on a.id = e.author_id
      where e.round_id = pg_temp.uid(p_round)))
$$;

create temp table da_m1 as select pg_temp.call_as(pg_temp.uid('M1'), pg_temp.fresh()) as r;
select is(
  (select r from da_m1) || ' ' || pg_temp.round_state('N'),
  'ok round=1 shooters=[1:- 2:M2] shots=[1:1 2:2] authors=[1:1:D 2:2:M2]',
  '射つ人2人のラウンドは、1人目の削除でその射手が紐づかなくなって残る'
);
create temp table da_m2 as select pg_temp.call_as(pg_temp.uid('M2'), pg_temp.fresh()) as r;
select is(
  (select r from da_m2) || ' ' || pg_temp.round_state('M'),
  'ok round=1 shooters=[1:- 2:- 3:M3] shots=[1:1 2:2 3:3] authors=[1:1:D 2:2:D 3:3:M3]',
  '射つ人3人のうち2人が順に削除すると、2人の矢と履歴は別々の番号の射手として残る'
);
select is(
  (select count(*) from public.rounds where id = pg_temp.uid('N'))
    + (select count(*) from public.round_users where round_id = pg_temp.uid('N'))
    + (select count(*) from public.shots where round_id = pg_temp.uid('N'))
    + (select count(*) from public.shot_events where round_id = pg_temp.uid('N')),
  0::bigint,
  '射つ人2人のラウンドは、2人目の削除で記録を残さず消える'
);

-- CH: 射手1の利用者をC1からC2へ変えた後に、C1を削除する。
select pg_temp.mk_user(u) from unnest(array['C1', 'C2']) as u;
select pg_temp.mk_round('CH', 'C1');
select pg_temp.join_round('CH', 'B', 'owner', 2);
select pg_temp.mk_shot('CH', 1, 1, 'C1');
update public.round_users set user_id = pg_temp.uid('C2') where round_id = pg_temp.uid('CH') and shooter_number = 1;
create temp table da_c1 as select pg_temp.call_as(pg_temp.uid('C1'), pg_temp.fresh()) as r;
select is(
  (select r from da_c1) || ' ' || pg_temp.round_state('CH'),
  'ok round=1 shooters=[1:C2 2:B] shots=[1:1] authors=[1:1:D]',
  '射手の利用者を変えた後に元の利用者を削除しても、番号は変更後の利用者のままで、操作者だけが匿名化先になる'
);

-- AN1・AN2: BとKが射つ人。AN3: Kは代理の人。
select pg_temp.mk_user('K');
select pg_temp.mk_round('AN1', 'B');
select pg_temp.join_round('AN1', 'K', 'owner', 2);
select pg_temp.mk_round('AN2', 'K');
select pg_temp.join_round('AN2', 'B', 'owner', 2);
select pg_temp.mk_round('AN3', 'B');
select pg_temp.join_round('AN3', 'K', 'editor');

create temp table da_anon_before as
select id, user_id, role, shooter_number from public.round_users
where round_id in (select pg_temp.uid(a) from unnest(array['AN1', 'AN2', 'AN3']) a);
select public.anonymize_round_shooter(pg_temp.uid('AN1'), pg_temp.uid('K'));
select public.anonymize_round_shooter(pg_temp.uid('AN3'), pg_temp.uid('K'));

select results_eq(
  $$select id, user_id, role, shooter_number from public.round_users
    where round_id in (select pg_temp.uid(a) from unnest(array['AN1', 'AN2', 'AN3']) a) order by id$$,
  $$select b.id,
      case when t.id is null then b.user_id end,
      case when t.id is null then b.role end,
      b.shooter_number
    from da_anon_before b
    left join public.round_users t on t.id = b.id and t.round_id = pg_temp.uid('AN1') and b.user_id = pg_temp.uid('K')
    order by b.id$$,
  '匿名化の内部関数は、指定したラウンドの指定した利用者の射手だけを匿名化し、番号の無い参加の行と他のラウンドは変えない'
);

create temp table da_anon_once as select pg_temp.snapshot() as snap;
select public.anonymize_round_shooter(pg_temp.uid('AN1'), pg_temp.uid('K'));
select is(
  pg_temp.snapshot(),
  (select snap from da_anon_once),
  '匿名化の内部関数をもう一度呼んでも、結果は変わらない'
);

select lives_ok(
  'set constraints all immediate',
  '順の削除と利用者の変更の後に残るラウンドは、射つ人の検査を通る'
);
set constraints all deferred;

-- ---- 関数の属性 ----

select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""', 'statement_timeout=60s']
    from pg_proc p where p.oid = 'public.delete_account(uuid)'::regprocedure),
  'delete_accountは、SECURITY DEFINERで、空のsearch_pathと60秒のstatement_timeoutを持つ'
);

select ok(
  (select not p.prosecdef and p.proconfig @> array['search_path=""']
    from pg_proc p where p.oid = 'public.purge_account(uuid)'::regprocedure),
  'purge_accountは、SECURITY INVOKERで、空のsearch_pathを持つ'
);

select ok(
  not has_function_privilege('service_role', 'public.purge_account(uuid)', 'execute')
    and (select p.proacl is not null and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
         from pg_proc p where p.oid = 'public.purge_account(uuid)'::regprocedure),
  'purge_accountの実行権限は、PUBLICにもservice_roleにも無い(anonとauthenticatedは行列が固定する)'
);

select * from finish();

rollback;
