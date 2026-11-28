begin;

select plan(20);

select ok(
  exists (select 1 from auth.users where id = '00000000-0000-4000-8000-000000000001'
    and banned_until = 'infinity' and email is null and encrypted_password is null)
    and exists (select 1 from public.users where id = '00000000-0000-4000-8000-000000000001'),
  '匿名化先は認証とプロフィールに存在し、無期限停止・メールなし・パスワードなしである'
);

select ok(
  exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'preset_rounds' and column_name = 'owner_id')
    and exists (select 1 from pg_constraint
      where conrelid = 'public.preset_rounds'::regclass and conname = 'preset_rounds_owner_id_fkey' and contype = 'f'),
  'preset_roundsのowner_idと外部キーを持つ'
);

select ok(
  exists (select 1 from pg_constraint
    where conrelid = 'public.round_users'::regclass and conname = 'round_users_round_id_fkey'
      and contype = 'f' and not condeferrable),
  'round_usersのラウンド外部キーは遅延不可である'
);

select is(
  (select count(*) from pg_constraint where conrelid in ('public.distances'::regclass, 'public.preset_distances'::regclass)
    and conname in ('distances_distance_max', 'distances_total_ends_max', 'distances_arrows_per_end_max',
      'preset_distances_distance_max', 'preset_distances_total_ends_max', 'preset_distances_arrows_per_end_max')
    and contype = 'c' and convalidated),
  6::bigint,
  '距離とプリセット距離の上限CHECKは6件とも有効である'
);

select is(
  (select count(*) from pg_class where oid in ('public.distances_round_id_idx'::regclass, 'public.round_users_user_id_idx'::regclass)
    and relkind = 'i'),
  2::bigint,
  '履歴用の2索引が存在する'
);

select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('distances', 'shots')
    and policyname = 'select_if_member' and cmd = 'SELECT'),
  2::bigint,
  'distancesとshotsのSELECTポリシーは各1件である'
);

select ok(
  to_regprocedure('public.history_rounds(text,text,date,date,jsonb)') is not null,
  'history_roundsは距離の構成の引数を持つ'
);

select ok(
  (select count(*) from public.target_faces) > 0
    and (select count(*) from public.target_face_spots) > 0
    and (select count(*) from public.target_face_rings) > 0
    and (select count(*) from public.preset_rounds where owner_id is null) > 0
    and (select count(*) from public.preset_distances) > 0,
  '公式の的3表と公式プリセット2表は投入されている'
);

-- 的の配置
select ok(
  exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'target_faces' and column_name = 'placement'
      and data_type = 'text' and is_nullable = 'NO' and column_default is null),
  'target_faces.placementはtextでNOT NULLで、既定値がない'
);

select ok(
  exists (select 1 from pg_constraint
    where conrelid = 'public.target_faces'::regclass and conname = 'target_faces_placement_check'
      and contype = 'c' and convalidated),
  'target_faces.placementの値を限るCHECK制約が有効である'
);

-- 矢のマス目形式
select is(
  (select array_agg(a.attname::text order by k.ord)
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.conrelid = 'public.shots'::regclass and c.contype = 'p'),
  array['distance_id', 'end_number', 'shot_number'],
  'shotsの主キーはマス(distance_id, end_number, shot_number)である'
);

select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and is_nullable = 'NO'
      and ((table_name = 'shots' and column_name in ('end_number', 'shot_number'))
        or (table_name = 'shot_events' and column_name in ('distance_id', 'end_number', 'shot_number')))),
  5::bigint,
  'shotsとshot_eventsのマスの列はNOT NULLである'
);

select is(
  (select array_agg(a.attname::text order by k.ord)
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.conrelid = 'public.shot_events'::regclass and c.contype = 'u'),
  array['distance_id', 'end_number', 'shot_number', 'revision'],
  'shot_eventsはマスとrevisionの組で一意である'
);

select ok(
  to_regprocedure('public.ensure_email_identity()') is not null
    and to_regprocedure('public.keep_email_identity()') is not null,
  'メールの手段を作る関数と、削除を拒否するトリガー関数が存在する'
);

select is(
  (select count(*) from pg_trigger where tgrelid = 'auth.identities'::regclass
    and tgname = 'keep_email_identity' and not tgisinternal and tgenabled = 'O'),
  1::bigint,
  'メールの手段の削除を拒否するトリガーがauth.identitiesに1件、有効で存在する'
);

-- 射手の番号参照
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name in ('shots', 'shot_events') and column_name = 'shooter_id'),
  0::bigint,
  'shotsとshot_eventsはshooter_idの列を持たない'
);

-- 外部キーを 表:列->参照先の列:削除時の動作+更新時の動作 で表す。
create function pg_temp.fks(p_parent regclass) returns text
language sql stable
as $$
  select string_agg(
    c.conrelid::regclass::text || ':'
      || (select string_agg(a.attname::text, ',' order by k.ord)
            from unnest(c.conkey) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
      || '->'
      || (select string_agg(a.attname::text, ',' order by k.ord)
            from unnest(c.confkey) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum)
      || ':' || c.confdeltype::text || c.confupdtype::text,
    ' ' order by c.conrelid::regclass::text, c.conname)
  from pg_constraint c
  where c.contype = 'f' and c.confrelid = p_parent
    and c.conrelid in ('public.shots'::regclass, 'public.shot_events'::regclass)
$$;

select is(
  pg_temp.fks('public.distances'),
  'shot_events:round_id,distance_id->round_id,id:aa shots:round_id,distance_id->round_id,id:ca',
  'shotsとshot_eventsの距離の外部キーは(round_id, distance_id)の1本だけで、矢だけが削除に連鎖する'
);

select is(
  pg_temp.fks('public.round_users'),
  'shot_events:round_id,shooter_number->round_id,shooter_number:aa shots:round_id,shooter_number->round_id,shooter_number:aa',
  'shotsとshot_eventsは射手を(round_id, shooter_number)で参照し、削除と更新に連鎖しない'
);

select is(
  (select count(*) from pg_index i
    where i.indrelid in ('public.shots'::regclass, 'public.shot_events'::regclass)
      and i.indisvalid
      and (select string_agg(a.attname::text, ',' order by k.ord)
             from unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
             join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum) = 'round_id,shooter_number'),
  2::bigint,
  'shotsとshot_eventsは(round_id, shooter_number)の索引を持つ'
);

select is(
  (select string_agg(confdeltype::text, ',') from pg_constraint
    where conrelid = 'public.round_users'::regclass and contype = 'f' and confrelid = 'public.users'::regclass),
  'a',
  'round_users.user_idの外部キーは利用者の削除に連鎖しない'
);

select * from finish();

rollback;
