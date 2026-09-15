begin;

select plan(10);

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

select * from finish();

rollback;
