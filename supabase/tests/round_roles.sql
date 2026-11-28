-- 射つ人の不変条件と、射つ人が複数いるラウンドの削除を確認する。
--   - 残るラウンドには射つ人が1人以上いる。検査はコミットの時点で働くため、SET CONSTRAINTS ALL IMMEDIATEで発火させる
--   - 射つ人が他にいるラウンドは、どの射つ人も削除できない
-- 唯一の射つ人の削除の許可と代理の人の拒否はrpc_matrix.sql、削除の再送と削除済みの結果はrounds.sqlで固定している。

begin;

select plan(11);

create temp table rr_id (alias text primary key, id uuid not null);
insert into rr_id (alias, id) values
  ('A',  'a6000000-0000-0000-0000-000000000001'),
  ('B',  'a6000000-0000-0000-0000-000000000002'),
  ('E',  'a6000000-0000-0000-0000-000000000003'),
  ('RN', 'a6000000-0000-0000-0000-000000000101'),
  ('RS', 'a6000000-0000-0000-0000-000000000102'),
  ('RT', 'a6000000-0000-0000-0000-000000000103'),
  ('RP', 'a6000000-0000-0000-0000-000000000104'),
  ('R0', 'a6000000-0000-0000-0000-000000000105'),
  ('R1', 'a6000000-0000-0000-0000-000000000106'),
  ('RL', 'a6000000-0000-0000-0000-000000000107'),
  ('R2', 'a6000000-0000-0000-0000-000000000108');

grant select on rr_id to authenticated;

create function pg_temp.id(p_alias text) returns uuid
language sql stable
as $$ select id from rr_id where alias = p_alias $$;

create function pg_temp.ev(p_n int) returns uuid
language sql immutable
as $$ select ('a6000000-0000-0000-0000-0000000e' || lpad(p_n::text, 4, '0'))::uuid $$;

-- 文を順に実行してから、コミットの時点の検査を発火させる。拒否されたときはSQLSTATEを返して全て取り消し、通ったときはokを返す。
create function pg_temp.commit_check(variadic p_statements text[]) returns text
language plpgsql
as $$
declare
  v_statement text;
begin
  foreach v_statement in array p_statements loop
    execute v_statement;
  end loop;
  set constraints all immediate;
  set constraints all deferred;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- ラウンドの参加の行を 利用者:役割:番号 で表す。
create function pg_temp.participants(p_round text) returns text
language sql stable
as $$
  select coalesce(string_agg(coalesce(i.alias, '-') || ':' || coalesce(u.role, '-') || ':' || coalesce(u.shooter_number::text, '-'), ' ' order by u.shooter_number, i.alias), '')
  from public.round_users u
  left join rr_id i on i.id = u.user_id
  where u.round_id = pg_temp.id(p_round)
$$;

create function pg_temp.insert_round(p_round text) returns text
language sql stable
as $$
  select format(
    'insert into public.rounds (id, name, round_date, format, bow_type) values (%L, %L, ''2026-10-01'', ''outdoor'', ''recurve'')',
    pg_temp.id(p_round), p_round
  )
$$;

create function pg_temp.insert_user(p_round text, p_user text, p_role text, p_number int) returns text
language sql stable
as $$
  select format(
    'insert into public.round_users (round_id, user_id, role, shooter_number) values (%L, %L, %L, %L)',
    pg_temp.id(p_round), pg_temp.id(p_user), p_role, p_number
  )
$$;

insert into auth.users (id) select id from rr_id where alias in ('A', 'B', 'E');

-- RS: 射つ人Aだけ(交代の確認)。RT: 射つ人AとB。RP: 物理削除用。RL: 最後の射つ人の確認用。R2: 削除を拒否する射つ人2人。
insert into public.rounds (id, name, round_date, format, bow_type)
select pg_temp.id(alias), alias, '2026-10-01', 'outdoor', 'recurve' from rr_id where alias in ('RS', 'RT', 'RP', 'RL', 'R2');
insert into public.round_users (round_id, user_id, role, shooter_number)
select pg_temp.id(v.round), pg_temp.id(v.usr), v.role, v.n
from (values
  ('RS', 'A', 'owner', 1),
  ('RT', 'A', 'owner', 1), ('RT', 'B', 'owner', 2),
  ('RP', 'A', 'owner', 1),
  ('RL', 'A', 'owner', 1), ('RL', 'E', 'editor', null), ('RL', null, null, 2),
  ('R2', 'A', 'owner', 1), ('R2', 'B', 'owner', 2), ('R2', 'E', 'editor', null)
) as v (round, usr, role, n);
set constraints all immediate;
set constraints all deferred;

-- ============================================================
-- 作成
-- ============================================================

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('A')::text, true);

select is(
  pg_temp.commit_check(format('select public.create_round(%L, %L, ''New'', ''2026-10-01'', ''outdoor'', ''recurve'', ''[]'')', pg_temp.ev(1), pg_temp.id('RN'))),
  'ok',
  'create_roundで作ったラウンドは、射つ人の検査を通る'
);
select is(pg_temp.participants('RN'), 'A:owner:1', 'create_roundは、作成者を射手1の射つ人にする');
select is(
  pg_temp.commit_check(format('select public.create_round(%L, %L, ''New'', ''2026-10-01'', ''outdoor'', ''recurve'', ''[]'')', pg_temp.ev(1), pg_temp.id('RN'))),
  'ok',
  '作成の再送は成功する'
);
select is(pg_temp.participants('RN'), 'A:owner:1', '作成の再送は射手を増やさない');

reset role;

-- ============================================================
-- 射つ人の不変条件
-- ============================================================

select is(
  pg_temp.commit_check(
    format('update public.round_users set user_id = null, role = null where round_id = %L and user_id = %L', pg_temp.id('RS'), pg_temp.id('A')),
    pg_temp.insert_user('RS', 'B', 'owner', 2)
  ),
  'ok',
  '同じトランザクションの途中で射つ人がいなくても、確定の時点でいれば通る'
);

select is(
  pg_temp.commit_check(format('delete from public.round_users where round_id = %L and user_id = %L', pg_temp.id('RT'), pg_temp.id('A'))),
  'ok',
  '射つ人が他にいれば、射つ人の行を消せる'
);

select is(
  pg_temp.commit_check(
    format('delete from public.round_events where round_id = %L', pg_temp.id('RP')),
    format('delete from public.rounds where id = %L', pg_temp.id('RP'))
  ),
  'ok',
  'ラウンドを物理削除するトランザクションは検査を通る'
);

select is(
  array[
    pg_temp.commit_check(pg_temp.insert_round('R0')),
    pg_temp.commit_check(
      pg_temp.insert_round('R1'),
      pg_temp.insert_user('R1', 'E', 'editor', null),
      format('insert into public.round_users (round_id, shooter_number) values (%L, 1)', pg_temp.id('R1'))
    )
  ],
  array['23514', '23514'],
  '参加の行が無いラウンドと、代理の人と紐づかない射手だけのラウンドは作れない'
);

select is(
  array[
    pg_temp.commit_check(format('delete from public.round_users where round_id = %L and user_id = %L', pg_temp.id('RL'), pg_temp.id('A'))),
    pg_temp.commit_check(format('update public.round_users set user_id = null, role = null where round_id = %L and user_id = %L', pg_temp.id('RL'), pg_temp.id('A')))
  ],
  array['23514', '23514'],
  '最後の射つ人は、行の削除でも匿名化でも失えない'
);

-- ============================================================
-- 射つ人が複数いるラウンドの削除
-- ============================================================

create temp table rr_before as
select to_jsonb(r) as round, (select count(*) from public.round_events e where e.round_id = r.id) as events
from public.rounds r where r.id = pg_temp.id('R2');

create function pg_temp.disable_code(p_event int, p_user text) returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.id(p_user)::text, true);
  perform public.disable_round(pg_temp.ev(p_event), pg_temp.id('R2'));
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

set local role authenticated;
select is(
  array[pg_temp.disable_code(2, 'A'), pg_temp.disable_code(3, 'B')],
  array['PT403', 'PT403'],
  '他に射つ人がいるラウンドは、どの射つ人も削除できない'
);
reset role;
select results_eq(
  $$select to_jsonb(r), (select count(*) from public.round_events e where e.round_id = r.id) from public.rounds r where r.id = pg_temp.id('R2')$$,
  $$select round, events from rr_before$$,
  '拒否された削除は、ラウンドの行と履歴を変えない'
);

select * from finish();

rollback;
