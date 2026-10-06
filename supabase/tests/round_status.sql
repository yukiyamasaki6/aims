-- ラウンドの状態（rounds.status）を、update_roundの差分のキー`status`で変える振る舞いを確認する。
--   - 既定値と、create_roundで作ったラウンドの初期状態
--   - statusが効く・不正値・削除済み・権限・冪等・他の項目との同時の変更
--   - round_eventsのstatus列とpayload制約
-- RPC × 観点の網羅（権限、入力検証、冪等性）はrpc_matrix.sqlで固定している。

begin;

select plan(23);

create temp table st_id (alias text primary key, id uuid not null);
insert into st_id (alias, id) values
  ('E',  'f0000000-0000-0000-0000-000000000001'),
  ('V',  'f0000000-0000-0000-0000-000000000002'),
  ('R1', 'f0000000-0000-0000-0000-000000000010'),
  ('R2', 'f0000000-0000-0000-0000-000000000011'),
  ('RD', 'f0000000-0000-0000-0000-000000000012'),
  ('RN', 'f0000000-0000-0000-0000-000000000013');

grant select on st_id to authenticated;

create function pg_temp.id(p_alias text) returns uuid
language sql stable
as $$ select id from st_id where alias = p_alias $$;

create function pg_temp.ev(p_n int) returns uuid
language sql immutable
as $$ select ('f0000000-0000-0000-0000-0000000e' || lpad(p_n::text, 4, '0'))::uuid $$;

create function pg_temp.fields(p_result jsonb) returns text
language sql immutable
as $$ select coalesce(array_to_string(array(select jsonb_array_elements_text(p_result -> 'applied_fields')), ','), '-') $$;

create function pg_temp.status(p_alias text) returns text
language sql stable
as $$ select status from public.rounds where id = pg_temp.id(p_alias) $$;

insert into auth.users (id) values (pg_temp.id('E')), (pg_temp.id('V'));

-- 直接INSERTしたラウンドは、列の既定値の入力中になる。
insert into public.rounds (id, name, round_date, format, bow_type) values
  (pg_temp.id('R1'), 'Status 1', '2026-01-01', 'outdoor', 'recurve'),
  (pg_temp.id('R2'), 'Status 2', '2026-01-01', 'outdoor', 'recurve'),
  (pg_temp.id('RD'), 'Status Disabled', '2026-01-01', 'outdoor', 'recurve');
insert into public.round_users (round_id, user_id, role) values
  (pg_temp.id('R1'), pg_temp.id('E'), 'editor'),
  (pg_temp.id('R2'), pg_temp.id('E'), 'editor'),
  (pg_temp.id('R2'), pg_temp.id('V'), 'viewer'),
  (pg_temp.id('RD'), pg_temp.id('E'), 'editor');

-- 既定値
select is(pg_temp.status('R1'), 'in_progress', 'rounds.status: 状態を指定せず作った行は入力中になる');
select is(
  (select is_nullable || '/' || column_default from information_schema.columns where table_schema = 'public' and table_name = 'rounds' and column_name = 'status'),
  'NO/''in_progress''::text',
  'rounds.status: NOT NULLで既定値は入力中である'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);

-- create_roundで作るラウンドは入力中で始まる。
select public.create_round(
  pg_temp.ev(1), pg_temp.id('RN'), 'Created', '2026-01-02', 'outdoor', 'recurve',
  jsonb_build_array(jsonb_build_object('distance_event_id', 'f0000000-0000-0000-0000-0000000e0100', 'id', 'f0000000-0000-0000-0000-0000000000d1', 'position_key', 'a', 'distance', 50, 'total_ends', 6, 'arrows_per_end', 6, 'target_face_id', (select id from public.target_faces order by id limit 1), 'is_marked', true))
);
select is(pg_temp.status('RN'), 'in_progress', 'create_round: 作成直後のラウンドは入力中になる');
select is((select status from public.round_events where event_id = pg_temp.ev(1)), null, 'create_round: CREATEDのイベントはstatusを持たない');

-- ============================================================
-- statusが効く
-- ============================================================

-- Given: 入力中のラウンド
-- When: 完了へ変える
create temp table st_r1 as
select public.update_round(pg_temp.ev(10), pg_temp.id('R1'), '{"status":"completed"}') as r;

-- Then: 効き、イベントにはstatusが残る
select is(pg_temp.fields((select r from st_r1)), 'status', 'update_round: statusが効いた項目として返る');
select is(pg_temp.status('R1'), 'completed', 'update_round: ラウンドのstatusが完了になる');
select is(
  (select set_fields::text || '/' || status || '/' || revision from public.round_events where event_id = pg_temp.ev(10)),
  '{status}/completed/2',
  'update_round: イベントのset_fieldsとstatusとrevisionが記録される'
);
select is(
  (select name from public.round_events where event_id = pg_temp.ev(10)) is null, true,
  'update_round: statusだけの変更では他の項目の値はイベントに残らない'
);

-- When: 入力中へ戻す（同じ値への再変更も含む）
select public.update_round(pg_temp.ev(11), pg_temp.id('R1'), '{"status":"in_progress"}');
select is(pg_temp.status('R1'), 'in_progress', 'update_round: 完了から入力中へ戻せる');
select public.update_round(pg_temp.ev(12), pg_temp.id('R1'), '{"status":"in_progress"}');
select is((select revision from public.rounds where id = pg_temp.id('R1')), 4::bigint, 'update_round: 同じ状態への変更も別の操作として確定する');

-- ============================================================
-- 他の項目との同時の変更
-- ============================================================

-- When: 名前と状態を1つの操作で変える
create temp table st_r2 as
select public.update_round(pg_temp.ev(13), pg_temp.id('R1'), '{"name":"Both","status":"completed"}') as r;
select is(pg_temp.fields((select r from st_r2)), 'name,status', 'update_round: 名前と状態は両方が効く');
select is(
  (select name || '/' || status from public.rounds where id = pg_temp.id('R1')),
  'Both/completed',
  'update_round: 名前と状態の両方が反映される'
);
-- When: 別の操作で名前だけを変える
select public.update_round(pg_temp.ev(14), pg_temp.id('R1'), '{"name":"Renamed Only"}');
select is(
  (select name || '/' || status from public.rounds where id = pg_temp.id('R1')),
  'Renamed Only/completed',
  'update_round: 名前だけの変更は状態を変えない'
);

-- ============================================================
-- 冪等
-- ============================================================

-- When: 確定済みのevent_idを再送する
create temp table st_r3 as
select public.update_round(pg_temp.ev(10), pg_temp.id('R1'), '{"status":"in_progress"}') as r;
select is(pg_temp.fields((select r from st_r3)) || '/' || (select r ->> 'revision' from st_r3), 'status/2', 'update_round: statusの再送は既存のrevisionと効いた項目を返す');
select is(pg_temp.status('R1'), 'completed', 'update_round: 再送は状態を変えない');

-- ============================================================
-- 不正値
-- ============================================================

select throws_ok(
  format($$select public.update_round(%L, %L, '{"status":"done"}')$$, pg_temp.ev(20), pg_temp.id('R1')),
  'PT422', '状態が不正です。', 'update_round: 未知の状態はPT422'
);
select throws_ok(
  format($$select public.update_round(%L, %L, '{"status":true}')$$, pg_temp.ev(21), pg_temp.id('R1')),
  'PT422', '状態が不正です。', 'update_round: 文字列でない状態はPT422'
);
select throws_ok(
  format($$select public.update_round(%L, %L, '{"status":null}')$$, pg_temp.ev(22), pg_temp.id('R1')),
  'PT422', '状態が不正です。', 'update_round: nullの状態はPT422'
);

-- ============================================================
-- 削除済み・権限
-- ============================================================

select public.disable_round(pg_temp.ev(30), pg_temp.id('RD'));
create temp table st_r4 as
select public.update_round(pg_temp.ev(31), pg_temp.id('RD'), '{"status":"completed"}') as r;
select is(
  (select (r ->> 'reason') || '/' || (r ->> 'applied') from st_r4) || '/' || pg_temp.status('RD'),
  'DISABLED/false/in_progress',
  'update_round: 削除済みのラウンドの状態の変更はDISABLEDで効かない'
);

select set_config('request.jwt.claim.sub', pg_temp.id('V')::text, true);
select throws_ok(
  format($$select public.update_round(%L, %L, '{"status":"completed"}')$$, pg_temp.ev(40), pg_temp.id('R2')),
  'PT403', null, 'update_round: viewerは状態を変えられない'
);
select is(pg_temp.status('R2'), 'in_progress', 'update_round: 拒否された状態の変更は反映されない');

-- ============================================================
-- round_eventsの制約
-- ============================================================

reset role;
select throws_ok(
  format($$insert into public.round_events (event_id, round_id, type, author_id, revision, set_fields, status) values (%L, %L, 'UPDATED', %L, 90, array['name'], 'completed')$$, pg_temp.ev(50), pg_temp.id('R2'), pg_temp.id('E')),
  '23514', null, 'round_events: set_fieldsにstatusが無いのにstatusを持つ行は拒否される'
);
select throws_ok(
  format($$insert into public.round_events (event_id, round_id, type, author_id, revision, set_fields) values (%L, %L, 'UPDATED', %L, 91, array['status'])$$, pg_temp.ev(51), pg_temp.id('R2'), pg_temp.id('E')),
  '23514', null, 'round_events: set_fieldsにstatusがあるのにstatusが無い行は拒否される'
);

select * from finish();

rollback;
