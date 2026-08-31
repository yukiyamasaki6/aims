begin;

select plan(7);

insert into auth.users (id) values ('55555555-5555-5555-5555-555555555555');

select results_eq(
  $$select count(*) from public.users where id = '55555555-5555-5555-5555-555555555555'$$,
  $$values (1::bigint)$$,
  'auth.usersへの新規作成でpublic.usersが自動生成される'
);

select is(
  (select id from public.users where id = '55555555-5555-5555-5555-555555555555'),
  '55555555-5555-5555-5555-555555555555'::uuid,
  'public.usersのidはauth.users.idと一致する'
);

-- auth.users削除時の連鎖検証: public.usersだけでなく、所有物やメンバー登録・
-- 記録済みshotsまで巻き込んでカスケード削除されることを確認する。
insert into auth.users (id) values ('e0000000-0000-0000-0000-000000000001');

insert into public.target_faces (owner_id, name, size, format)
values ('e0000000-0000-0000-0000-000000000001', 'Owned Target', 80, 'outdoor');

insert into public.round_presets (owner_id, name, format, bow_type)
values ('e0000000-0000-0000-0000-000000000001', 'Owned Preset', 'outdoor', 'recurve');

insert into public.rounds (id, name, round_date, format, bow_type)
values ('e0000000-0000-0000-0000-000000000002', 'User Delete Round', current_date, 'outdoor', 'recurve');

insert into public.round_users (round_id, user_id, role)
values ('e0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', 'editor');

insert into public.distances (id, round_id, distance_number, distance, total_ends, arrows_per_end, target_face_id)
values ('e0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000002', 1, 70, 6, 6, 'a1000000-0000-0000-0000-000000000001');

insert into public.shots (distance_id, end_number, arrow_number, user_id, score_str, score_int)
values ('e0000000-0000-0000-0000-000000000003', 1, 1, 'e0000000-0000-0000-0000-000000000001', 'X', 10);

delete from auth.users where id = 'e0000000-0000-0000-0000-000000000001';

select is_empty(
  $$select id from public.users where id = 'e0000000-0000-0000-0000-000000000001'$$,
  'auth.users削除でpublic.usersもカスケード削除される'
);

select is_empty(
  $$select id from public.target_faces where owner_id = 'e0000000-0000-0000-0000-000000000001'$$,
  'auth.users削除で所有するtarget_facesもカスケード削除される'
);

select is_empty(
  $$select id from public.round_presets where owner_id = 'e0000000-0000-0000-0000-000000000001'$$,
  'auth.users削除で所有するround_presetsもカスケード削除される'
);

select is_empty(
  $$select round_id from public.round_users where user_id = 'e0000000-0000-0000-0000-000000000001'$$,
  'auth.users削除でround_usersのメンバー登録もカスケード削除される'
);

select is_empty(
  $$select distance_id from public.shots where user_id = 'e0000000-0000-0000-0000-000000000001'$$,
  'auth.users削除で記録したshotsもカスケード削除される'
);

select * from finish();

rollback;
