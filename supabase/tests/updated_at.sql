begin;

select plan(17);

insert into auth.users (id) values ('d0000000-0000-0000-0000-000000000001');

insert into public.rounds (id, name, round_date, format, bow_type)
values ('d0000000-0000-0000-0000-000000000002', 'updated_at round', current_date, 'outdoor', 'recurve');

insert into public.round_users (id, round_id, user_id, role)
values ('d0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'editor');

insert into public.target_faces (id, owner_id, name, size, format, bow_type)
values ('d0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001', 'updated_at target', 80, 'outdoor', array['recurve']);

insert into public.target_face_spots (id, target_face_id, center_x, center_y)
values ('d0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000004', 0, 0);

insert into public.target_face_rings (id, spot_id, radius, color, z_index, score_str, score_int)
values ('d0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000005', 1, '#FFFFFF', 1, 'X', 10);

insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
values ('d0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000002', 'a', 70, 6, 6, 'd0000000-0000-0000-0000-000000000004');

insert into public.shots (distance_id, end_number, arrow_number, shooter_id, score_str, score_int)
values ('d0000000-0000-0000-0000-000000000007', 1, 1, 'd0000000-0000-0000-0000-000000000001', 'X', 10);

insert into public.preset_rounds (id, owner_id, name, format, bow_type)
values ('d0000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000001', 'updated_at preset', 'outdoor', 'recurve');

insert into public.preset_distances (id, preset_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
values ('d0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000009', 'a', 70, 6, 6, 'd0000000-0000-0000-0000-000000000004');

update public.users set updated_at = '2000-01-01', name = 'updated user'
  where id = 'd0000000-0000-0000-0000-000000000001';
update public.rounds set updated_at = '2000-01-01', name = 'updated round'
  where id = 'd0000000-0000-0000-0000-000000000002';
update public.round_users set updated_at = '2000-01-01', role = 'viewer'
  where id = 'd0000000-0000-0000-0000-000000000003';
update public.distances set updated_at = '2000-01-01', distance = 60
  where id = 'd0000000-0000-0000-0000-000000000007';
update public.shots set updated_at = '2000-01-01', score_str = '9', score_int = 9
  where distance_id = 'd0000000-0000-0000-0000-000000000007' and end_number = 1 and arrow_number = 1;
update public.target_faces set updated_at = '2000-01-01', name = 'updated target'
  where id = 'd0000000-0000-0000-0000-000000000004';
update public.target_face_spots set updated_at = '2000-01-01', center_x = 1
  where id = 'd0000000-0000-0000-0000-000000000005';
update public.target_face_rings set updated_at = '2000-01-01', radius = 2
  where id = 'd0000000-0000-0000-0000-000000000006';
update public.preset_rounds set updated_at = '2000-01-01', name = 'updated preset'
  where id = 'd0000000-0000-0000-0000-000000000009';
update public.preset_distances set updated_at = '2000-01-01', distance = 60
  where id = 'd0000000-0000-0000-0000-00000000000a';

select ok((select updated_at > '2000-01-01' from public.users where id = 'd0000000-0000-0000-0000-000000000001'), 'usersのupdated_atが更新される');
select ok((select updated_at > '2000-01-01' from public.rounds where id = 'd0000000-0000-0000-0000-000000000002'), 'roundsのupdated_atが更新される');
select ok((select updated_at > '2000-01-01' from public.round_users where id = 'd0000000-0000-0000-0000-000000000003'), 'round_usersのupdated_atが更新される');
select ok((select updated_at > '2000-01-01' from public.distances where id = 'd0000000-0000-0000-0000-000000000007'), 'distancesのupdated_atが更新される');
select ok((select updated_at > '2000-01-01' from public.shots where distance_id = 'd0000000-0000-0000-0000-000000000007' and end_number = 1 and arrow_number = 1), 'shotsのupdated_atが更新される');
select ok((select updated_at > '2000-01-01' from public.target_faces where id = 'd0000000-0000-0000-0000-000000000004'), 'target_facesのupdated_atが更新される');
select ok((select updated_at > '2000-01-01' from public.target_face_spots where id = 'd0000000-0000-0000-0000-000000000005'), 'target_face_spotsのupdated_atが更新される');
select ok((select updated_at > '2000-01-01' from public.target_face_rings where id = 'd0000000-0000-0000-0000-000000000006'), 'target_face_ringsのupdated_atが更新される');
select ok((select updated_at > '2000-01-01' from public.preset_rounds where id = 'd0000000-0000-0000-0000-000000000009'), 'preset_roundsのupdated_atが更新される');
select ok((select updated_at > '2000-01-01' from public.preset_distances where id = 'd0000000-0000-0000-0000-00000000000a'), 'preset_distancesのupdated_atが更新される');

-- round_events/distance_events/shot_eventsはRLSでINSERT/UPDATEポリシーを
-- 持たないため直接操作できないが、このファイルはRLSを経由しないロールで
-- 実行されている（他のテーブルへの直接INSERTと同様）。ここではカタログ照会
-- ではなく実際の値を検証し、(1) created_atがclock_timestamp()採用により
-- 同一トランザクション内でも単調増加すること、(2) updated_atの初期値が
-- created_atより前にならないこと、(3) UPDATEトリガーが実際に発火することを
-- 確認する。

insert into public.round_events (event_id, round_id, type, author_id, revision, name, round_date, format, bow_type)
values ('d0000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-000000000002', 'CREATED', 'd0000000-0000-0000-0000-000000000001', 1, 'a', current_date, 'outdoor', 'recurve');

select pg_sleep(0.01);

insert into public.round_events (event_id, round_id, type, author_id, revision, name, round_date, format, bow_type)
values ('d0000000-0000-0000-0000-00000000000c', 'd0000000-0000-0000-0000-000000000002', 'UPDATED', 'd0000000-0000-0000-0000-000000000001', 2, 'b', current_date, 'outdoor', 'recurve');

select ok(
  (select created_at from public.round_events where event_id = 'd0000000-0000-0000-0000-00000000000c')
    > (select created_at from public.round_events where event_id = 'd0000000-0000-0000-0000-00000000000b'),
  'round_events.created_atは同一トランザクション内でも単調増加する（clock_timestamp）'
);

select ok(
  (select updated_at >= created_at from public.round_events where event_id = 'd0000000-0000-0000-0000-00000000000b'),
  'round_eventsの作成直後のupdated_atはcreated_atより前にならない'
);

update public.round_events set name = 'c' where event_id = 'd0000000-0000-0000-0000-00000000000b';

select ok(
  (select updated_at > created_at from public.round_events where event_id = 'd0000000-0000-0000-0000-00000000000b'),
  'round_eventsのupdated_atはUPDATEで更新される'
);

insert into public.distance_events (event_id, round_id, distance_id, type, author_id, revision, position_key, distance, is_marked, total_ends, arrows_per_end, target_face_id)
values ('d0000000-0000-0000-0000-00000000000d', 'd0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000007', 'CREATED', 'd0000000-0000-0000-0000-000000000001', 1, 'a', 70, true, 6, 6, 'd0000000-0000-0000-0000-000000000004');

select ok(
  (select updated_at >= created_at from public.distance_events where event_id = 'd0000000-0000-0000-0000-00000000000d'),
  'distance_eventsの作成直後のupdated_atはcreated_atより前にならない'
);

update public.distance_events set position_key = 'b' where event_id = 'd0000000-0000-0000-0000-00000000000d';

select ok(
  (select updated_at > created_at from public.distance_events where event_id = 'd0000000-0000-0000-0000-00000000000d'),
  'distance_eventsのupdated_atはUPDATEで更新される'
);

insert into public.shot_events (event_id, distance_id, type, author_id, revision, end_number, arrow_number, shooter_id, score_str, score_int)
values ('d0000000-0000-0000-0000-00000000000e', 'd0000000-0000-0000-0000-000000000007', 'RECORDED', 'd0000000-0000-0000-0000-000000000001', 1, 1, 1, 'd0000000-0000-0000-0000-000000000001', 'X', 10);

select ok(
  (select updated_at >= created_at from public.shot_events where event_id = 'd0000000-0000-0000-0000-00000000000e'),
  'shot_eventsの作成直後のupdated_atはcreated_atより前にならない'
);

update public.shot_events set score_str = '9' where event_id = 'd0000000-0000-0000-0000-00000000000e';

select ok(
  (select updated_at > created_at from public.shot_events where event_id = 'd0000000-0000-0000-0000-00000000000e'),
  'shot_eventsのupdated_atはUPDATEで更新される'
);

select * from finish();

rollback;
