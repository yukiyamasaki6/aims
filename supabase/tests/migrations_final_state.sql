begin;

select plan(15);

select ok(
  exists (select 1 from auth.users where id = '00000000-0000-4000-8000-000000000001'
    and banned_until = 'infinity' and email is null and encrypted_password is null)
    and exists (select 1 from public.users where id = '00000000-0000-4000-8000-000000000001'),
  '匿名化先は認証とプロフィールに存在し、無期限停止・メールなし・パスワードなしである'
);

select is_empty(
  $$select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'target_faces' and column_name = 'owner_id'$$,
  'target_facesに廃止済みのowner_idはない'
);

select ok(
  exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'preset_rounds' and column_name = 'owner_id')
    and exists (select 1 from pg_constraint
      where conrelid = 'public.preset_rounds'::regclass and conname = 'preset_rounds_owner_id_fkey' and contype = 'f'),
  'preset_roundsのowner_idと外部キーは残る'
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
  'distancesとshotsの最終SELECTポリシーは各1件である'
);

select is_empty(
  $$select proname from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('distances_capacity_guard', 'shots_capacity_guard')$$,
  '廃止済みの容量ガード関数はない'
);

select is_empty(
  $$select tgname from pg_trigger where tgrelid in ('public.distances'::regclass, 'public.shots'::regclass)
    and tgname in ('distances_capacity_guard', 'shots_capacity_guard') and not tgisinternal$$,
  '廃止済みの容量ガードトリガーはない'
);

select is_empty(
  $$select conname from pg_constraint where conrelid in
    ('public.round_events'::regclass, 'public.distance_events'::regclass, 'public.shot_events'::regclass)
    and conname like '%_payload_by_type'$$,
  'イベント表に廃止済みのpayload_by_type制約はない'
);

select is(
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'history_rounds'),
  1::bigint,
  '履歴関数は最終署名だけが存在する'
);

select ok(
  to_regprocedure('public.history_rounds(text,text,date,date,jsonb)') is not null,
  '履歴関数の最終署名は距離フィルタを受け取る'
);

select is_empty(
  $$select 1 from pg_constraint where conrelid = 'public.target_faces'::regclass
    and contype = 'f' and conname like '%owner_id%'$$,
  'target_facesに廃止済みのowner_id外部キーはない'
);

select is_empty(
  $$select 1 from pg_description d join pg_attribute a on a.attrelid = d.objoid and a.attnum = d.objsubid
    where d.objoid in ('public.distance_events'::regclass, 'public.round_events'::regclass,
      'public.shot_events'::regclass, 'public.shots'::regclass, 'public.rounds'::regclass)
      and (d.objoid, a.attname) in (
        ('public.distance_events'::regclass, 'set_fields'), ('public.round_events'::regclass, 'set_fields'),
        ('public.round_events'::regclass, 'status'), ('public.rounds'::regclass, 'status'),
        ('public.shot_events'::regclass, 'shot_id'), ('public.shot_events'::regclass, 'shot_number'),
        ('public.shot_events'::regclass, 'set_fields'), ('public.shots'::regclass, 'id'),
        ('public.shots'::regclass, 'shot_number'))$$,
  '削除済みの列コメントはない'
);

select ok(
  (select count(*) from public.target_faces) > 0
    and (select count(*) from public.target_face_spots) > 0
    and (select count(*) from public.target_face_rings) > 0
    and (select count(*) from public.preset_rounds where owner_id is null) > 0
    and (select count(*) from public.preset_distances) > 0,
  '公式の的3表と公式プリセット2表は投入されている'
);

select * from finish();

rollback;
