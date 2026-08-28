begin;

select plan(9);

select has_column('public', 'rounds', 'format', 'rounds.format カラムが存在する');
select has_column('public', 'rounds', 'bow_type', 'rounds.bow_type カラムが存在する');
select has_column('public', 'distances', 'target_face_id', 'distances.target_face_id カラムが存在する');

insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

select create_round(
  'Format Test Round', current_date, 'outdoor', 'recurve',
  '[{"distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
) as round_id \gset

select results_eq(
  $$select format, bow_type from public.rounds where id = '$$ || :'round_id' || $$'$$,
  $$values ('outdoor'::text, 'recurve'::text)$$,
  'create_round経由でrounds.format/bow_typeが保存される'
);

select results_eq(
  $$select target_face_id from public.distances where round_id = '$$ || :'round_id' || $$'$$,
  $$values ('a1000000-0000-0000-0000-000000000001'::uuid)$$,
  'create_round経由でdistances.target_face_idが保存される'
);

select throws_ok(
  $$update public.rounds set format = 'invalid' where id = '$$ || :'round_id' || $$'$$,
  '23514',
  null,
  '不正なformatはCHECK制約で拒否される'
);

select throws_ok(
  $$update public.rounds set bow_type = 'invalid' where id = '$$ || :'round_id' || $$'$$,
  '23514',
  null,
  '不正なbow_typeはCHECK制約で拒否される'
);

select throws_ok(
  $$update public.distances set target_face_id = '00000000-0000-0000-0000-000000000000'
    where round_id = '$$ || :'round_id' || $$'$$,
  '23503',
  null,
  '存在しないtarget_face_idは外部キー制約で拒否される'
);

select throws_ok(
  $$select create_round(
    'No Format Round', current_date, null, 'recurve',
    '[{"distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
  )$$,
  '23502',
  null,
  'formatを省略した作成はNOT NULL制約で拒否される'
);

select * from finish();

rollback;
