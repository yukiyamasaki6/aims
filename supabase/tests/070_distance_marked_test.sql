begin;

select plan(9);

select has_column('public', 'distances', 'is_marked', 'distances.is_marked カラムが存在する');
select has_column(
  'public', 'round_preset_distances', 'is_marked',
  'round_preset_distances.is_marked カラムが存在する'
);

-- Fixture: ラウンドと1つの距離。
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111');

insert into public.rounds (id, name, round_date, format, bow_type)
values ('22222222-2222-2222-2222-222222222222', 'Test Round', current_date, 'field', 'recurve');

insert into public.distances (id, round_id, distance_number, distance, total_ends, arrows_per_end, target_face_id)
values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 1, 70, 6, 6, 'a1000000-0000-0000-0000-000000000001');

select results_eq(
  $$select is_marked from public.distances where id = '33333333-3333-3333-3333-333333333333'$$,
  $$values (true)$$,
  'is_markedを省略すると既定値はtrue'
);

select lives_ok(
  $$insert into public.distances
      (round_id, distance_number, distance, total_ends, arrows_per_end, target_face_id, is_marked)
    values
      ('22222222-2222-2222-2222-222222222222', 2, null, 6, 6, 'a1000000-0000-0000-0000-000000000001', false)$$,
  'is_marked=falseならdistanceがnullでも挿入できる（アンマークドで距離不明）'
);

select lives_ok(
  $$insert into public.distances
      (round_id, distance_number, distance, total_ends, arrows_per_end, target_face_id, is_marked)
    values
      ('22222222-2222-2222-2222-222222222222', 3, 55, 6, 6, 'a1000000-0000-0000-0000-000000000001', false)$$,
  'is_marked=falseでもdistanceを持てる（自己目測の記録）'
);

select throws_ok(
  $$insert into public.distances
      (round_id, distance_number, distance, total_ends, arrows_per_end, target_face_id, is_marked)
    values
      ('22222222-2222-2222-2222-222222222222', 4, null, 6, 6, 'a1000000-0000-0000-0000-000000000001', true)$$,
  '23514',
  null,
  'is_marked=true（既定）でdistanceがnullだとCHECK制約で拒否される'
);

-- Fixture: round_preset_distances側も同様に検証する。
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

insert into public.round_presets (id, owner_id, name, format, bow_type)
values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'My Field Preset', 'field', 'recurve');

insert into public.round_preset_distances
  (id, preset_id, distance_number, distance, total_ends, arrows_per_end, target_face_id)
values
  ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444', 1, 50, 4, 4, 'a1000000-0000-0000-0000-000000000010');

select results_eq(
  $$select is_marked from public.round_preset_distances where id = '55555555-5555-5555-5555-555555555555'$$,
  $$values (true)$$,
  'round_preset_distances.is_markedを省略すると既定値はtrue'
);

select lives_ok(
  $$insert into public.round_preset_distances
      (preset_id, distance_number, distance, total_ends, arrows_per_end, target_face_id, is_marked)
    values
      ('44444444-4444-4444-4444-444444444444', 2, null, 4, 4, 'a1000000-0000-0000-0000-000000000010', false)$$,
  'round_preset_distancesもis_marked=falseならdistanceがnullでも挿入できる'
);

select throws_ok(
  $$insert into public.round_preset_distances
      (preset_id, distance_number, distance, total_ends, arrows_per_end, target_face_id, is_marked)
    values
      ('44444444-4444-4444-4444-444444444444', 3, null, 4, 4, 'a1000000-0000-0000-0000-000000000010', true)$$,
  '23514',
  null,
  'round_preset_distancesもis_marked=true（既定）でdistanceがnullだとCHECK制約で拒否される'
);

select * from finish();

rollback;
