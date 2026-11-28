-- 射手の持ち方と、射手を指す書き込みを確認する。
--   - 参加の行は、射つ人・代理の人・利用者に紐づかない射手の3種類だけで、矢と矢の履歴は同じラウンドの射手と距離を参照する
--   - record_shots・clear_shotsは指定した射手を保存し、番号の形の拒否は認可と存在の確認より先である
--   - add_round_shooterは無い番号だけを足す
--   - 番号に結び付く利用者が変わると、過去の矢も変更後の利用者の矢になる
-- 役割ごとの可否はrpc_matrix.sql、同じマスの上書き・生き返り・構成の範囲はshot_identity.sql、射つ人の不変条件はround_roles.sqlで固定している。

begin;

select plan(57);

create temp table sh_id (alias text primary key, id uuid not null);
insert into sh_id (alias, id) values
  ('A',  'a5000000-0000-0000-0000-000000000001'),
  ('B',  'a5000000-0000-0000-0000-000000000002'),
  ('E',  'a5000000-0000-0000-0000-000000000003'),
  ('N',  'a5000000-0000-0000-0000-000000000004'),
  ('C',  'a5000000-0000-0000-0000-000000000005'),
  ('P',  'a5000000-0000-0000-0000-000000000006'),
  ('DEL', '00000000-0000-4000-8000-000000000001'),
  ('R',  'a5000000-0000-0000-0000-000000000101'),
  ('R2', 'a5000000-0000-0000-0000-000000000102'),
  ('RX', 'a5000000-0000-0000-0000-000000000103'),
  ('RY', 'a5000000-0000-0000-0000-000000000104'),
  ('RC', 'a5000000-0000-0000-0000-000000000105'),
  ('RA', 'a5000000-0000-0000-0000-000000000106'),
  ('RB', 'a5000000-0000-0000-0000-000000000107'),
  ('RP', 'a5000000-0000-0000-0000-000000000108'),
  ('RU', 'a5000000-0000-0000-0000-000000000109'),
  ('RZ', 'a5000000-0000-0000-0000-0000000001ff'),
  ('D1', 'a5000000-0000-0000-0000-000000000201'),
  ('D2', 'a5000000-0000-0000-0000-000000000202'),
  ('D3', 'a5000000-0000-0000-0000-000000000203'),
  ('DX', 'a5000000-0000-0000-0000-000000000204'),
  ('DY', 'a5000000-0000-0000-0000-000000000205'),
  ('DP', 'a5000000-0000-0000-0000-000000000206'),
  ('DU', 'a5000000-0000-0000-0000-000000000207'),
  ('DK', 'a5000000-0000-0000-0000-000000000208'),
  ('DZ', 'a5000000-0000-0000-0000-0000000002ff');

grant select on sh_id to authenticated;

create function pg_temp.id(p_alias text) returns uuid
language sql stable
as $$ select id from sh_id where alias = p_alias $$;

create function pg_temp.ev(p_n int) returns uuid
language sql immutable
as $$ select ('a5000000-0000-0000-0000-0000000e' || lpad(p_n::text, 4, '0'))::uuid $$;

create function pg_temp.face() returns uuid
language sql stable
as $$ select id from public.target_faces order by id limit 1 $$;

-- 記録の要素。射手番号はJSONの値をそのまま入れ、SQLのNULLはキーを省く。
create function pg_temp.rec(p_event int, p_distance text, p_end int, p_number int, p_shooter jsonb, p_score int default 9) returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'shot_event_id', pg_temp.ev(p_event), 'distance_id', pg_temp.id(p_distance),
    'end_number', p_end, 'shot_number', p_number, 'score_str', p_score::text, 'score_int', p_score
  ) || case when p_shooter is null then '{}'::jsonb else jsonb_build_object('shooter_number', p_shooter) end
$$;

create function pg_temp.clr(p_event int, p_distance text, p_end int, p_number int) returns jsonb
language sql stable
as $$ select jsonb_build_object('shot_event_id', pg_temp.ev(p_event), 'distance_id', pg_temp.id(p_distance), 'end_number', p_end, 'shot_number', p_number) $$;

-- 文を実行し、拒否されたときはSQLSTATE、受け付けたときはokを返す。受け付けた変更は残る。
create function pg_temp.code(p_sql text) returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.record_code(p_shots jsonb) returns text
language sql
as $$ select pg_temp.code(format('select public.record_shots(%L::jsonb)', p_shots)) $$;

create function pg_temp.add_code(p_round text, p_number text) returns text
language sql
as $$ select pg_temp.code(format('select public.add_round_shooter(%L, %s)', pg_temp.id(p_round), p_number)) $$;

-- 全ての参加の行・矢・矢の履歴の指紋。拒否で何も増減しないことを比べる。
create function pg_temp.state() returns text
language sql security definer
as $$
  select md5(
    coalesce((select string_agg(to_jsonb(u)::text, ',' order by u.id) from public.round_users u), '')
    || '|' || coalesce((select string_agg(to_jsonb(s)::text, ',' order by s.distance_id, s.end_number, s.shot_number) from public.shots s), '')
    || '|' || coalesce((select string_agg(to_jsonb(e)::text, ',' order by e.event_id) from public.shot_events e), '')
  )
$$;

create temp table sh_state (n text primary key, v text not null);
grant select, insert on sh_state to authenticated;

-- ラウンドの射手の行を 番号:利用者:役割 で番号順に表す。
create function pg_temp.shooters(p_round text) returns text
language sql stable security definer
as $$
  select coalesce(string_agg(u.shooter_number || ':' || coalesce(i.alias, '-') || ':' || coalesce(u.role, '-'), ' ' order by u.shooter_number), '')
  from public.round_users u
  left join sh_id i on i.id = u.user_id
  where u.round_id = pg_temp.id(p_round) and u.shooter_number is not null
$$;

-- マスの矢を ラウンド/射手番号/生死 で表す。
create function pg_temp.shot(p_distance text, p_end int, p_number int) returns text
language sql stable
as $$
  select coalesce((
    select i.alias || '/s' || s.shooter_number || case when s.disabled_at is null then '/live' else '/cleared' end
    from public.shots s join sh_id i on i.id = s.round_id
    where s.distance_id = pg_temp.id(p_distance) and s.end_number = p_end and s.shot_number = p_number
  ), 'absent')
$$;

-- マスの履歴を 種別/ラウンド/射手番号/操作者 でrevision順に並べる。
create function pg_temp.events(p_distance text, p_end int, p_number int) returns text
language sql stable
as $$
  select coalesce(string_agg(e.type || '/' || r.alias || '/s' || e.shooter_number || '/' || a.alias, ' ' order by e.revision), '')
  from public.shot_events e
  join sh_id r on r.id = e.round_id
  join sh_id a on a.id = e.author_id
  where e.distance_id = pg_temp.id(p_distance) and e.end_number = p_end and e.shot_number = p_number
$$;

insert into auth.users (id) select id from sh_id where alias in ('A', 'B', 'E', 'N', 'C', 'P');

-- R: 射手1=A(射つ人)、射手2=紐づかない、射手3=B(射つ人)、代理の人E。
-- R2: 射手1=N、射手2と射手9は紐づかない。RX: 削除済みのラウンド。RY: 削除済みの距離を持つラウンド。
-- RC: 参加の行の組合せと更新の確認用。RA・RB: 追加の確認用。RP: 物理削除の確認用。RU: 利用者の変更用。
insert into public.rounds (id, name, round_date, format, bow_type, disabled_at)
select pg_temp.id(alias), alias, '2026-10-01', 'outdoor', 'recurve', case when alias = 'RX' then now() end
from sh_id where alias in ('R', 'R2', 'RX', 'RY', 'RC', 'RA', 'RB', 'RP', 'RU');

insert into public.round_users (round_id, user_id, role, shooter_number)
select pg_temp.id(v.round), pg_temp.id(v.usr), v.role, v.n
from (values
  ('R', 'A', 'owner', 1), ('R', null, null, 2), ('R', 'B', 'owner', 3), ('R', 'E', 'editor', null),
  ('R2', 'N', 'owner', 1), ('R2', null, null, 2), ('R2', null, null, 9),
  ('RX', 'A', 'owner', 1), ('RX', null, null, 2),
  ('RY', 'A', 'owner', 1),
  ('RC', 'N', 'owner', 1),
  ('RA', 'A', 'owner', 1), ('RB', 'A', 'owner', 1),
  ('RP', 'A', 'owner', 1), ('RP', null, null, 2),
  ('RU', 'A', 'owner', 1)
) as v (round, usr, role, n);

insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, disabled_at)
select pg_temp.id(v.d), pg_temp.id(v.round), v.k, 70, 12, 3, pg_temp.face(), case when v.d = 'DY' then now() end
from (values
  ('D1', 'R', 'a'), ('D2', 'R', 'b'), ('D3', 'R2', 'a'), ('DX', 'RX', 'a'), ('DY', 'RY', 'a'),
  ('DP', 'RP', 'a'), ('DU', 'RU', 'a'), ('DK', 'RA', 'a')
) as v (d, round, k);

set constraints all immediate;
set constraints all deferred;

-- ============================================================
-- 参加と射手の行
-- ============================================================

-- 役割・利用者・番号の全ての組合せを1行ずつ挿入して試し、行は残さない。
create function pg_temp.try_row(p_role text, p_user uuid, p_number int) returns text
language plpgsql
as $$
begin
  begin
    insert into public.round_users (round_id, user_id, role, shooter_number)
    values (pg_temp.id('RC'), p_user, p_role, p_number);
    raise exception using errcode = 'P0002';
  exception
    when sqlstate 'P0002' then return 'ok';
    when others then return sqlstate;
  end;
end;
$$;

select results_eq(
  $$select coalesce(r.role, '-') || '/' || u.has_user || '/' || n.has_number || '=' ||
      pg_temp.try_row(r.role, case when u.has_user then pg_temp.id('A') end, case when n.has_number then 2 end)
    from (values (1, 'owner'), (2, 'editor'), (3, 'viewer'), (4, null)) as r (o, role),
      (values (true), (false)) as u (has_user),
      (values (true), (false)) as n (has_number)
    order by r.o, u.has_user desc, n.has_number desc$$,
  $$values
    ('owner/true/true=ok'), ('owner/true/false=23514'), ('owner/false/true=23514'), ('owner/false/false=23514'),
    ('editor/true/true=23514'), ('editor/true/false=ok'), ('editor/false/true=23514'), ('editor/false/false=23514'),
    ('viewer/true/true=23514'), ('viewer/true/false=23514'), ('viewer/false/true=23514'), ('viewer/false/false=23514'),
    ('-/true/true=23514'), ('-/true/false=23514'), ('-/false/true=ok'), ('-/false/false=23514')$$,
  '参加の行は、射つ人・代理の人・利用者に紐づかない射手の3組だけを保存できる'
);

select is(
  array[pg_temp.try_row('owner', pg_temp.id('A'), 0), pg_temp.try_row(null, null, -1), pg_temp.try_row('owner', pg_temp.id('DEL'), 2), pg_temp.try_row('editor', pg_temp.id('DEL'), null)],
  array['23514', '23514', '23514', '23514'],
  '番号は1以上で、削除済みの利用者は結び付けられない'
);

insert into public.round_users (round_id, user_id, role, shooter_number) values (pg_temp.id('RC'), pg_temp.id('E'), 'editor', null);
insert into sh_state select 'invalid', pg_temp.state();

select is(
  array[
    pg_temp.code($$update public.round_users set shooter_number = null where round_id = pg_temp.id('RC') and user_id = pg_temp.id('N')$$),
    pg_temp.code($$update public.round_users set user_id = null where round_id = pg_temp.id('RC') and user_id = pg_temp.id('N')$$),
    pg_temp.code($$update public.round_users set shooter_number = 5 where round_id = pg_temp.id('RC') and user_id = pg_temp.id('E')$$)
  ],
  array['23514', '23514', '23514'],
  '射つ人の番号と利用者を外すこと、代理の人へ番号を足すことは拒否される'
);
select is(pg_temp.state(), (select v from sh_state where n = 'invalid'), '拒否された更新で、行は変わらない');

select throws_ok(
  $$insert into public.round_users (round_id, user_id, role, shooter_number) values (pg_temp.id('R'), pg_temp.id('A'), 'owner', 4)$$,
  '23505', null, '同じラウンドの同じ利用者の2行目は拒否される'
);
select throws_ok(
  $$insert into public.round_users (round_id, user_id, role, shooter_number) values (pg_temp.id('R'), null, null, 2)$$,
  '23505', null, '同じラウンドの同じ番号の2行目は拒否される'
);
select lives_ok(
  $$insert into public.round_users (round_id, user_id, role, shooter_number) values (pg_temp.id('RC'), null, null, 2)$$,
  '別のラウンドでは同じ番号を使える'
);

-- 番号の2は矢が参照せず、移し先のRBに同じ番号が無いため、番号の固定の規則だけが拒否の理由になる。
insert into sh_state select 'fixed', pg_temp.state();
select throws_ok(
  $$update public.round_users set shooter_number = 8 where round_id = pg_temp.id('RC') and shooter_number = 2$$,
  '23514', null, '一度付いた射手の番号は変えられない'
);
select throws_ok(
  $$update public.round_users set round_id = pg_temp.id('RB') where round_id = pg_temp.id('RC') and shooter_number = 2$$,
  '23514', null, '射手の行のラウンドは変えられない'
);
select is(pg_temp.state(), (select v from sh_state where n = 'fixed'), '拒否された番号とラウンドの変更で、行は変わらない');

-- ============================================================
-- 矢と矢の履歴の参照
-- ============================================================

create function pg_temp.insert_shot(p_round text, p_distance text, p_number int) returns text
language sql
as $$
  select pg_temp.code(format(
    'insert into public.shots (round_id, distance_id, end_number, shot_number, shooter_number, score_str, score_int) values (%L, %L, 12, 3, %L, ''9'', 9)',
    pg_temp.id(p_round), pg_temp.id(p_distance), p_number
  ))
$$;

create function pg_temp.insert_event(p_round text, p_distance text, p_number int) returns text
language sql
as $$
  select pg_temp.code(format(
    'insert into public.shot_events (event_id, round_id, distance_id, end_number, shot_number, type, author_id, revision, shooter_number) values (gen_random_uuid(), %L, %L, 12, 3, ''CLEARED'', %L, 1, %L)',
    pg_temp.id(p_round), pg_temp.id(p_distance), pg_temp.id('A'), p_number
  ))
$$;

insert into sh_state select 'fk', pg_temp.state();

-- 順に、無い番号、他のラウンドだけにある番号、round_idと距離のラウンドの不一致。
select is(
  array[pg_temp.insert_shot('R', 'D1', 8), pg_temp.insert_shot('R', 'D1', 9), pg_temp.insert_shot('R2', 'D1', 1)],
  array['23503', '23503', '23503'],
  '矢は、同じラウンドの射手と距離だけを参照できる'
);
select is(
  array[pg_temp.insert_event('R', 'D1', 8), pg_temp.insert_event('R', 'D1', 9), pg_temp.insert_event('R2', 'D1', 1)],
  array['23503', '23503', '23503'],
  '矢の履歴は、同じラウンドの射手と距離だけを参照できる'
);
select is(
  array[pg_temp.insert_shot(null, 'D1', 1), pg_temp.insert_shot('R', 'D1', null), pg_temp.insert_event(null, 'D1', 1), pg_temp.insert_event('R', 'D1', null)],
  array['23502', '23502', '23502', '23502'],
  '矢と矢の履歴は、ラウンドと射手番号の無い行を持てない'
);
select is(pg_temp.state(), (select v from sh_state where n = 'fk'), '拒否された矢と履歴の挿入で、行は増えない');

-- 射手4は矢だけ、射手5は履歴だけが参照する。
insert into public.round_users (round_id, user_id, role, shooter_number) values (pg_temp.id('RC'), null, null, 4), (pg_temp.id('RC'), null, null, 5);
insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
values (pg_temp.id('DZ'), pg_temp.id('RC'), 'a', 70, 12, 3, pg_temp.face());
insert into public.shots (round_id, distance_id, end_number, shot_number, shooter_number, score_str, score_int)
values (pg_temp.id('RC'), pg_temp.id('DZ'), 1, 1, 4, '9', 9);
insert into public.shot_events (event_id, round_id, distance_id, end_number, shot_number, type, author_id, revision, shooter_number)
values (pg_temp.ev(900), pg_temp.id('RC'), pg_temp.id('DZ'), 1, 2, 'CLEARED', pg_temp.id('N'), 1, 5);

select is(
  array[
    pg_temp.code($$delete from public.round_users where round_id = pg_temp.id('RC') and shooter_number = 4$$),
    pg_temp.code($$delete from public.round_users where round_id = pg_temp.id('RC') and shooter_number = 5$$)
  ],
  array['23503', '23503'],
  '矢または矢の履歴が参照する射手の行は削除できない'
);

-- Pは参加の行だけを持ち、操作の履歴を持たない。
insert into public.round_users (round_id, user_id, role, shooter_number) values (pg_temp.id('RC'), pg_temp.id('P'), 'editor', null);
select throws_ok(
  $$delete from auth.users where id = pg_temp.id('P')$$,
  '23503', null, '参加の行が残る利用者の削除は拒否される'
);
select is(
  (select count(*) from public.round_users where user_id = pg_temp.id('P')),
  1::bigint,
  '利用者の削除は参加の行を連鎖で消さない'
);

-- ============================================================
-- record_shots・clear_shotsの射手
-- ============================================================

insert into sh_state select 'participants', md5((select string_agg(to_jsonb(u)::text, ',' order by u.id) from public.round_users u));

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('B')::text, true);

-- 操作する射つ人B(射手3)が、自分、別の射つ人、紐づかない射手の番号で記録する。
select public.record_shots(jsonb_build_array(
  pg_temp.rec(1, 'D1', 1, 1, '3'), pg_temp.rec(2, 'D1', 1, 2, '1'), pg_temp.rec(3, 'D1', 1, 3, '2')
));
select is(
  array[pg_temp.shot('D1', 1, 1), pg_temp.shot('D1', 1, 2), pg_temp.shot('D1', 1, 3)],
  array['R/s3/live', 'R/s1/live', 'R/s2/live'],
  '射つ人の記録は、指定した射手の矢を距離のラウンドで保存する'
);
select is(
  array[pg_temp.events('D1', 1, 1), pg_temp.events('D1', 1, 2), pg_temp.events('D1', 1, 3)],
  array['RECORDED/R/s3/B', 'RECORDED/R/s1/B', 'RECORDED/R/s2/B'],
  '射つ人の記録は、指定した射手の履歴を距離のラウンドで保存する'
);

select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);
select public.record_shots(jsonb_build_array(pg_temp.rec(4, 'D1', 2, 1, '3')));
select is(
  pg_temp.shot('D1', 2, 1) || ' ' || pg_temp.events('D1', 2, 1),
  'R/s3/live RECORDED/R/s3/E',
  '代理の人の記録は指定した射手の矢になり、操作者は代理の人である'
);

select public.record_shots(jsonb_build_array(pg_temp.rec(5, 'D1', 3, 1, '1')));
select public.record_shots(jsonb_build_array(pg_temp.rec(6, 'D1', 3, 1, '2')));
select public.record_shots(jsonb_build_array(pg_temp.rec(7, 'D1', 3, 1, '1')));
select is(
  pg_temp.shot('D1', 3, 1) || ' ' || pg_temp.events('D1', 3, 1),
  'R/s1/live RECORDED/R/s1/E RECORDED/R/s2/E RECORDED/R/s1/E',
  '付け替えた射手を元へ戻しても、履歴は各記録の射手を保つ'
);

select set_config('request.jwt.claim.sub', pg_temp.id('N')::text, true);
select public.record_shots(jsonb_build_array(pg_temp.rec(8, 'D3', 1, 1, '2')));
select set_config('request.jwt.claim.sub', pg_temp.id('A')::text, true);
reset role;
select is(
  array[pg_temp.shot('D3', 1, 1), pg_temp.shot('D1', 1, 3)],
  array['R2/s2/live', 'R/s2/live'],
  '同じ番号は、ラウンドごとの射手を指す'
);
select is(
  md5((select string_agg(to_jsonb(u)::text, ',' order by u.id) from public.round_users u)),
  (select v from sh_state where n = 'participants'),
  '記録は射手の行を増やさず変えない'
);

set local role authenticated;

-- 射手2(紐づかない)の矢をクリアする。
select public.clear_shots(jsonb_build_array(pg_temp.clr(9, 'D1', 1, 3)));
select is(
  pg_temp.shot('D1', 1, 3) || ' ' || pg_temp.events('D1', 1, 3),
  'R/s2/cleared RECORDED/R/s2/B CLEARED/R/s2/A',
  'クリアは射手を変えず、取り消しの履歴に同じ番号を残す'
);

insert into sh_state select 'missing', pg_temp.state();
select is(
  public.clear_shots(jsonb_build_array(pg_temp.clr(10, 'D1', 4, 1))) -> 0 ->> 'reason',
  'MISSING',
  '記録の無いマスのクリアはMISSINGになる'
);
select is(pg_temp.state(), (select v from sh_state where n = 'missing'), '記録の無いマスのクリアは、射手も履歴も作らない');

insert into sh_state select 'resend', pg_temp.state();
select is(
  public.record_shots(jsonb_build_array(pg_temp.rec(1, 'D1', 1, 1, '2', 7))) -> 0,
  '{"revision":1,"applied":true,"applied_fields":["score","shooter_number"],"rejected_fields":[],"reason":null}'::jsonb,
  '同じevent_idの再送は、番号が違っても記録した結果を返す'
);
select is(pg_temp.state(), (select v from sh_state where n = 'resend'), '同じevent_idの再送は、矢と履歴の射手を変えない');

select is(
  array[
    public.record_shots(jsonb_build_array(pg_temp.rec(11, 'DX', 1, 1, '8'))) -> 0 ->> 'reason',
    public.record_shots(jsonb_build_array(pg_temp.rec(12, 'DY', 1, 1, '8'))) -> 0 ->> 'reason'
  ],
  array['DISABLED', 'DISABLED'],
  '削除済みのラウンドと距離への記録は、射手の検査より先にDISABLEDになる'
);

-- 順に、無い番号、他のラウンドだけにある番号、構成の範囲外のマスと無い番号の組合せ。
insert into sh_state select 'forbidden', pg_temp.state();
select is(
  array[
    pg_temp.record_code(jsonb_build_array(pg_temp.rec(13, 'D1', 5, 1, '8'))),
    pg_temp.record_code(jsonb_build_array(pg_temp.rec(14, 'D1', 5, 1, '9'))),
    pg_temp.record_code(jsonb_build_array(pg_temp.rec(15, 'D1', 13, 1, '8')))
  ],
  array['PT403', 'PT403', 'PT403'],
  'ラウンドに無い番号は、構成の範囲外のマスでもUNFITより先にPT403で拒否する'
);
select is(
  pg_temp.record_code(jsonb_build_array(pg_temp.rec(16, 'D1', 5, 1, '1'), pg_temp.rec(17, 'D1', 5, 2, '8'))),
  'PT403',
  '無い番号の要素を含む要求は拒否される'
);
select is(pg_temp.state(), (select v from sh_state where n = 'forbidden'), '無い番号の拒否は、有効な要素を含めて何も保存せず、射手も増やさない');

-- ============================================================
-- 射手の番号の検査
-- ============================================================

reset role;
insert into public.round_users (round_id, user_id, role, shooter_number) values (pg_temp.id('RA'), null, null, 2147483647);
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('A')::text, true);

select is(
  array[pg_temp.add_code('RA', $$'2.0'::jsonb$$), pg_temp.add_code('RB', $$'2e0'::jsonb$$), pg_temp.add_code('RB', $$'1'::jsonb$$), pg_temp.add_code('RB', $$'2'::jsonb$$), pg_temp.add_code('RB', $$'2147483647'::jsonb$$)],
  array['ok', 'ok', 'ok', 'ok', 'ok'],
  'add_round_shooterは、整数として1〜2147483647のJSON数値を受理する'
);
select is(
  array[pg_temp.shooters('RA'), pg_temp.shooters('RB')],
  array['1:A:owner 2:-:- 2147483647:-:-', '1:A:owner 2:-:- 2147483647:-:-'],
  '受理した番号は整数で保存される'
);

select is(
  pg_temp.record_code(jsonb_build_array(
    pg_temp.rec(20, 'DK', 1, 1, '1'), pg_temp.rec(21, 'DK', 1, 2, '2'), pg_temp.rec(22, 'DK', 1, 3, '2147483647'),
    pg_temp.rec(23, 'DK', 2, 1, '2.0'), pg_temp.rec(24, 'DK', 2, 2, '2e0')
  )),
  'ok',
  'record_shotsは、整数として1〜2147483647のJSON数値を受理する'
);
select results_eq(
  $$select shooter_number from public.shots where distance_id = pg_temp.id('DK') order by end_number, shot_number$$,
  $$values (1), (2), (2147483647), (2), (2)$$,
  '記録は整数の番号で保存される'
);

-- 拒否するJSONの値。add_round_shooterとrecord_shotsに同じ表を適用する。
create temp table sh_bad (n int primary key, label text not null, value text not null);
insert into sh_bad (n, label, value) values
  (1, 'json null', 'null'), (2, 'string 2', '"2"'), (3, 'string abc', '"abc"'), (4, 'boolean', 'true'), (5, 'array', '[2]'),
  (6, 'object', '{"n":2}'), (7, 'zero', '0'), (8, 'negative', '-1'), (9, 'fraction', '1.5'),
  (10, 'over integer', '2147483648'), (11, 'over bigint', '99999999999999999999');
grant select on sh_bad to authenticated;

insert into sh_state select 'invalid-number', pg_temp.state();

select results_eq(
  $$select label || '=' || pg_temp.add_code('R', format('%L::jsonb', value)) from sh_bad order by n$$,
  $$select label || '=PT422' from sh_bad order by n$$,
  'add_round_shooterは、整数の1〜2147483647でない値をPT422で拒否する'
);
select is(
  array[
    pg_temp.code(format('select public.add_round_shooter(%L)', pg_temp.id('R'))),
    pg_temp.add_code('R', 'null')
  ],
  array['PT422', 'PT422'],
  'add_round_shooterは、番号の引数の省略とSQLのNULLをPT422で拒否する'
);
select results_eq(
  $$select label || '=' || pg_temp.record_code(jsonb_build_array(pg_temp.rec(100 + n, 'D1', 6, 1, value::jsonb))) from sh_bad order by n$$,
  $$select label || '=PT422' from sh_bad order by n$$,
  'record_shotsは、整数の1〜2147483647でない値をPT422で拒否する'
);
select is(
  pg_temp.record_code(jsonb_build_array(pg_temp.rec(130, 'D1', 6, 1, null))),
  'PT422',
  'record_shotsは、番号のキーの省略をPT422で拒否する'
);
select is(
  pg_temp.record_code(jsonb_build_array(pg_temp.rec(131, 'D1', 6, 1, '1'), pg_temp.rec(132, 'D1', 6, 2, '0'))),
  'PT422',
  '不正な番号の要素を含む要求は拒否される'
);

-- Nは、ラウンドRに参加していない。
select set_config('request.jwt.claim.sub', pg_temp.id('N')::text, true);
select is(
  array[
    pg_temp.record_code(jsonb_build_array(pg_temp.rec(133, 'D1', 6, 1, '0'))),
    pg_temp.record_code(jsonb_build_array(pg_temp.rec(134, 'DZ', 1, 1, '0') || jsonb_build_object('distance_id', gen_random_uuid()))),
    pg_temp.add_code('R', $$'0'::jsonb$$),
    pg_temp.add_code('RZ', $$'0'::jsonb$$)
  ],
  array['PT422', 'PT422', 'PT422', 'PT422'],
  '番号の形の拒否は、認可と存在の確認より先である'
);
select is(pg_temp.state(), (select v from sh_state where n = 'invalid-number'), '不正な番号の拒否は、何も保存しない');

-- ============================================================
-- add_round_shooter
-- ============================================================

select set_config('request.jwt.claim.sub', pg_temp.id('A')::text, true);

-- RYは射手1だけのラウンドである。
select is(
  public.add_round_shooter(pg_temp.id('RY'), '7'),
  '{"revision":null,"applied":true,"reason":null}'::jsonb,
  '無い番号の追加は、成功の応答を返す'
);
select is(pg_temp.shooters('RY'), '1:A:owner 7:-:-', '利用者と役割の無い射手が指定の番号で1行だけ増え、欠番は補わない');

-- 行の位置(ctid)は更新のたびに変わるため、書き換えが無いことを比べられる。
insert into sh_state
select 'existing', string_agg(ctid::text || to_jsonb(u)::text, ',' order by u.shooter_number)
from public.round_users u where u.round_id = pg_temp.id('R') and u.shooter_number in (1, 2);
select is(
  array[public.add_round_shooter(pg_temp.id('R'), '1'), public.add_round_shooter(pg_temp.id('R'), '2')],
  array['{"revision":null,"applied":true,"reason":null}'::jsonb, '{"revision":null,"applied":true,"reason":null}'::jsonb],
  '射つ人の番号と紐づかない射手の番号の追加は、成功の応答を返す'
);
select is(
  (select string_agg(ctid::text || to_jsonb(u)::text, ',' order by u.shooter_number)
    from public.round_users u where u.round_id = pg_temp.id('R') and u.shooter_number in (1, 2)),
  (select v from sh_state where n = 'existing'),
  '既にある番号の追加は、利用者、役割、ID、更新時刻を変えない'
);

select is(
  array[
    public.add_round_shooter(pg_temp.id('RY'), '4') ->> 'applied',
    public.add_round_shooter(pg_temp.id('RY'), '4') ->> 'applied',
    public.add_round_shooter(pg_temp.id('RB'), '7') ->> 'applied'
  ],
  array['true', 'true', 'true'],
  '同じ追加の再送と、別のラウンドの同じ番号の追加は成功する'
);
select is(
  array[pg_temp.shooters('RY'), pg_temp.shooters('RB')],
  array['1:A:owner 4:-:- 7:-:-', '1:A:owner 2:-:- 7:-:- 2147483647:-:-'],
  '再送しても射手は1行で、別のラウンドの同じ番号は別の射手である'
);

-- RAに射手6を追加し、記録、クリア、距離の削除を行う。
select public.add_round_shooter(pg_temp.id('RA'), '6');
select public.record_shots(jsonb_build_array(pg_temp.rec(30, 'DK', 3, 1, '6')));
select public.clear_shots(jsonb_build_array(pg_temp.clr(31, 'DK', 3, 1)));
select public.disable_distance(pg_temp.ev(32), pg_temp.id('DK'));
select is(
  pg_temp.shot('DK', 3, 1) || ' ' || pg_temp.shooters('RA'),
  'RA/s6/cleared 1:A:owner 2:-:- 6:-:- 2147483647:-:-',
  '追加した射手は矢の記録で指定でき、矢の取り消しと距離の削除の後も残る'
);

insert into sh_state select 'not-applied', pg_temp.state();
select is(
  array[
    public.add_round_shooter(pg_temp.id('RZ'), '5'),
    public.add_round_shooter(pg_temp.id('RX'), '5'),
    public.add_round_shooter(pg_temp.id('RX'), '2')
  ],
  array[
    '{"revision":null,"applied":false,"reason":"MISSING"}'::jsonb,
    '{"revision":null,"applied":false,"reason":"DISABLED"}'::jsonb,
    '{"revision":null,"applied":false,"reason":"DISABLED"}'::jsonb
  ],
  '無いラウンドはMISSING、削除済みのラウンドは既にある番号を含めてDISABLEDで適用しない'
);

select set_config('request.jwt.claim.sub', pg_temp.id('N')::text, true);
select is(
  array[
    public.add_round_shooter(pg_temp.id('RZ'), '5') ->> 'reason',
    pg_temp.add_code('RX', $$'5'::jsonb$$)
  ],
  array['MISSING', 'PT403'],
  '認可は存在の確認の後、削除の判定より先である'
);
select is(pg_temp.state(), (select v from sh_state where n = 'not-applied'), '適用しない追加と拒否した追加は、行を変えない');

-- ============================================================
-- 番号に結び付く利用者の変更
-- ============================================================

select set_config('request.jwt.claim.sub', pg_temp.id('A')::text, true);
select public.record_shots(jsonb_build_array(pg_temp.rec(40, 'DU', 1, 1, '1')));
reset role;
-- CはRUに行を持たない。
update public.round_users set user_id = pg_temp.id('C') where round_id = pg_temp.id('RU') and shooter_number = 1;
select is(
  pg_temp.shot('DU', 1, 1) || ' ' || pg_temp.events('DU', 1, 1) || ' '
    || (select i.alias from public.shots s
          join public.round_users u on u.round_id = s.round_id and u.shooter_number = s.shooter_number
          join sh_id i on i.id = u.user_id
          where s.distance_id = pg_temp.id('DU')),
  'RU/s1/live RECORDED/RU/s1/A C',
  '射手1の利用者を変えると、番号と操作者はそのままで、過去の矢は変更後の利用者の矢になる'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('C')::text, true);
select public.add_round_shooter(pg_temp.id('RU'), '1');
select is(pg_temp.shooters('RU'), '1:C:owner', '利用者を変えた番号の追加は、作った人へ戻さない');

-- ============================================================
-- ラウンドの物理削除
-- ============================================================

select set_config('request.jwt.claim.sub', pg_temp.id('A')::text, true);
select public.record_shots(jsonb_build_array(pg_temp.rec(51, 'DP', 1, 1, '2')));
reset role;
create temp table sh_other as
select (select count(*) from public.distances where round_id <> pg_temp.id('RP')) as distances,
  (select count(*) from public.shots where round_id <> pg_temp.id('RP')) as shots,
  (select count(*) from public.round_users where round_id <> pg_temp.id('RP')) as users;
delete from public.shot_events where round_id = pg_temp.id('RP');
delete from public.distance_events where round_id = pg_temp.id('RP');
delete from public.round_events where round_id = pg_temp.id('RP');
delete from public.rounds where id = pg_temp.id('RP');
select is(
  (select count(*) from public.distances where round_id = pg_temp.id('RP'))
    + (select count(*) from public.shots where round_id = pg_temp.id('RP'))
    + (select count(*) from public.round_users where round_id = pg_temp.id('RP')),
  0::bigint,
  '履歴を消した後のラウンドの物理削除で、距離・矢・射手が残らない'
);
select is(
  array[
    (select count(*) from public.distances),
    (select count(*) from public.shots),
    (select count(*) from public.round_users)
  ],
  (select array[distances, shots, users] from sh_other),
  'ラウンドの物理削除は、他のラウンドの行を消さない'
);

select * from finish();

rollback;
