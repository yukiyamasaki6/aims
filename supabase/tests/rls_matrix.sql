-- RLS・GRANTの「テーブル × 操作 × アクター」マトリクステスト。
-- 現在の挙動を期待値表として固定し、ポリシーやGRANTの変更を表の差分として見えるようにする。
-- 個別のテーブルの意図は各テーブルのテストファイルで確認し、このファイルは全体の一覧性と網羅性を担う。
--
-- 実行結果は 'rows:N'（SELECTで見える行数、UPDATE/DELETEの影響行数、INSERT成功は1）か
-- 'error:SQLSTATE'（権限不足・RLS違反など）に正規化する。
-- rows:0 はRLSのUSING句で対象行が見えず、静かに0件になったことを表す。
-- error:42501 はGRANT不足（permission denied）とRLSのWITH CHECK違反の両方を表す。
-- どちらで拒否されたかは、後段のテーブル権限の期待値表（anon・authenticated × 権限）で固定する。
-- 書き込みポリシーのない操作はGRANTも付けず、行を見る前にpermission deniedで拒否する。
--
-- アクター
--   editor / viewer / non_member / anon: ラウンド系。editor・viewerは対象ラウンドのメンバー
--   owner / other / anon: 所有者系。ownerは対象行の所有者、otherは別のauthenticatedユーザー
--   self / other / anon: users。selfは対象行の本人、otherは別のauthenticatedユーザー
-- INSERTは所有者（owner）または対象ラウンドに属する新規行を追加する文で、アクターだけを切り替える。

begin;

select plan(20);

-- fixture: 各アクターに対応するユーザーと、検証対象の行を用意する。
-- 接続ロール（RLS対象外）で直接INSERTする。
-- 検証ケースはすべてサブトランザクション内で実行して巻き戻すため、fixtureはケース間で共有しても壊れない。
insert into auth.users (id) values
  ('b0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000003'),
  ('b0000000-0000-0000-0000-000000000004'),
  ('b0000000-0000-0000-0000-000000000005'),
  ('b0000000-0000-0000-0000-000000000006');

-- handle_new_userで自動生成されるpublic.usersを消し、INSERTが成功し得る状態のidを作る。
delete from public.users where id = 'b0000000-0000-0000-0000-000000000004';

insert into public.target_faces (id, owner_id, name, size, format, bow_type)
values ('b0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000001', 'Matrix Target', 80, 'outdoor', array['recurve']);

insert into public.target_face_spots (id, target_face_id, center_x, center_y)
values ('b0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000010', 0, 0);

insert into public.target_face_rings (id, spot_id, radius, color, z_index, score_str, score_int)
values ('b0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000011', 1, '#ffffff', 1, 'X', 10);

insert into public.preset_rounds (id, owner_id, name, format, bow_type)
values ('b0000000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-000000000001', 'Matrix Preset', 'outdoor', 'recurve');

insert into public.preset_distances (id, preset_id, distance, total_ends, arrows_per_end, target_face_id, position_key)
values ('b0000000-0000-0000-0000-000000000014', 'b0000000-0000-0000-0000-000000000013', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001', 'a');

insert into public.rounds (id, name, round_date, format, bow_type)
values ('b0000000-0000-0000-0000-000000000020', 'Matrix Round', current_date, 'outdoor', 'recurve');

insert into public.round_users (id, round_id, user_id, role) values
  ('b0000000-0000-0000-0000-000000000022', 'b0000000-0000-0000-0000-000000000020', 'b0000000-0000-0000-0000-000000000001', 'editor'),
  ('b0000000-0000-0000-0000-000000000023', 'b0000000-0000-0000-0000-000000000020', 'b0000000-0000-0000-0000-000000000002', 'viewer');

insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
values ('b0000000-0000-0000-0000-000000000021', 'b0000000-0000-0000-0000-000000000020', 'a', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001');

insert into public.shots (distance_id, end_number, arrow_number, shooter_id, score_str, score_int)
values ('b0000000-0000-0000-0000-000000000021', 1, 1, 'b0000000-0000-0000-0000-000000000005', 'X', 10);

insert into public.round_events (event_id, round_id, type, author_id, revision, name, round_date, format, bow_type)
values ('b0000000-0000-0000-0000-000000000030', 'b0000000-0000-0000-0000-000000000020', 'CREATED', 'b0000000-0000-0000-0000-000000000005', 1, 'Matrix Round', current_date, 'outdoor', 'recurve');

insert into public.distance_events (event_id, round_id, distance_id, type, author_id, revision, position_key, distance, is_marked, total_ends, arrows_per_end, target_face_id)
values ('b0000000-0000-0000-0000-000000000031', 'b0000000-0000-0000-0000-000000000020', 'b0000000-0000-0000-0000-000000000021', 'CREATED', 'b0000000-0000-0000-0000-000000000005', 1, 'a', 70, true, 6, 6, 'a1000000-0000-0000-0000-000000000001');

insert into public.shot_events (event_id, distance_id, type, author_id, revision, end_number, arrow_number, shooter_id, score_str, score_int)
values ('b0000000-0000-0000-0000-000000000032', 'b0000000-0000-0000-0000-000000000021', 'RECORDED', 'b0000000-0000-0000-0000-000000000005', 1, 1, 1, 'b0000000-0000-0000-0000-000000000005', 'X', 10);

-- 検証対象のDBロール（target）と、権限を持っていてよい内部ロール（internal）。
-- PUBLICの権限は、targetの各ロールへの実効権限として実測側に現れるため、内部ロールとして許容する。
create temp table rls_role (role_name text primary key, kind text not null check (kind in ('target', 'internal')));
insert into rls_role (role_name, kind) values
  ('anon', 'target'),
  ('authenticated', 'target'),
  ('postgres', 'internal'),
  ('PUBLIC', 'internal');

-- アクター名 → 接続ロールとauth.uid()。anonはuidを持たない。
-- adminは検証SQLの妥当性確認用で、テーブルには対応付けない。
create temp table rls_actor (actor text primary key, db_role text not null references rls_role, uid uuid);
insert into rls_actor (actor, db_role, uid) values
  ('editor', 'authenticated', 'b0000000-0000-0000-0000-000000000001'),
  ('viewer', 'authenticated', 'b0000000-0000-0000-0000-000000000002'),
  ('non_member', 'authenticated', 'b0000000-0000-0000-0000-000000000003'),
  ('owner', 'authenticated', 'b0000000-0000-0000-0000-000000000001'),
  ('other', 'authenticated', 'b0000000-0000-0000-0000-000000000003'),
  ('self', 'authenticated', 'b0000000-0000-0000-0000-000000000006'),
  ('anon', 'anon', null),
  ('admin', 'postgres', null);

-- テーブルごとのアクター集合。
create temp table rls_table_actor (tbl text, actor text references rls_actor, primary key (tbl, actor));
insert into rls_table_actor (tbl, actor)
select t.tbl, a.actor
from (values
  ('rounds', 'member'), ('distances', 'member'), ('shots', 'member'), ('round_users', 'member'),
  ('round_events', 'member'), ('distance_events', 'member'), ('shot_events', 'member'),
  ('target_faces', 'owner'), ('target_face_spots', 'owner'), ('target_face_rings', 'owner'),
  ('preset_rounds', 'owner'), ('preset_distances', 'owner'),
  ('users', 'self')
) as t(tbl, kind)
join (values
  ('member', 'editor'), ('member', 'viewer'), ('member', 'non_member'), ('member', 'anon'),
  ('owner', 'owner'), ('owner', 'other'), ('owner', 'anon'),
  ('self', 'self'), ('self', 'other'), ('self', 'anon')
) as a(kind, actor) using (kind);

-- 操作ごとのSQL。アクターに依らず同じ文を実行し、結果の違いだけをアクター差として観測する。
-- SELECT/UPDATE/DELETEはfixtureの行、INSERTはfixtureの所有者・ラウンドに属する新規行を対象にする。
create temp table rls_stmt (tbl text, op text, stmt text, primary key (tbl, op));
insert into rls_stmt (tbl, op, stmt) values
  ('users', 'select', $q$select 1 from public.users where id = 'b0000000-0000-0000-0000-000000000006'$q$),
  ('users', 'insert', $q$insert into public.users (id) values ('b0000000-0000-0000-0000-000000000004')$q$),
  ('users', 'update', $q$update public.users set name = 'changed' where id = 'b0000000-0000-0000-0000-000000000006'$q$),
  ('users', 'delete', $q$delete from public.users where id = 'b0000000-0000-0000-0000-000000000006'$q$),

  ('target_faces', 'select', $q$select 1 from public.target_faces where id = 'b0000000-0000-0000-0000-000000000010'$q$),
  ('target_faces', 'insert', $q$insert into public.target_faces (id, owner_id, name, size, format, bow_type) values ('b0000000-0000-0000-0000-000000000090', 'b0000000-0000-0000-0000-000000000001', 'New Target', 80, 'outdoor', array['recurve'])$q$),
  ('target_faces', 'update', $q$update public.target_faces set name = 'changed' where id = 'b0000000-0000-0000-0000-000000000010'$q$),
  ('target_faces', 'delete', $q$delete from public.target_faces where id = 'b0000000-0000-0000-0000-000000000010'$q$),

  ('target_face_spots', 'select', $q$select 1 from public.target_face_spots where id = 'b0000000-0000-0000-0000-000000000011'$q$),
  ('target_face_spots', 'insert', $q$insert into public.target_face_spots (id, target_face_id, center_x, center_y) values ('b0000000-0000-0000-0000-000000000091', 'b0000000-0000-0000-0000-000000000010', 1, 1)$q$),
  ('target_face_spots', 'update', $q$update public.target_face_spots set center_x = 1 where id = 'b0000000-0000-0000-0000-000000000011'$q$),
  ('target_face_spots', 'delete', $q$delete from public.target_face_spots where id = 'b0000000-0000-0000-0000-000000000011'$q$),

  ('target_face_rings', 'select', $q$select 1 from public.target_face_rings where id = 'b0000000-0000-0000-0000-000000000012'$q$),
  ('target_face_rings', 'insert', $q$insert into public.target_face_rings (id, spot_id, radius, color, z_index, score_str, score_int) values ('b0000000-0000-0000-0000-000000000092', 'b0000000-0000-0000-0000-000000000011', 2, '#000000', 2, '9', 9)$q$),
  ('target_face_rings', 'update', $q$update public.target_face_rings set color = '#111111' where id = 'b0000000-0000-0000-0000-000000000012'$q$),
  ('target_face_rings', 'delete', $q$delete from public.target_face_rings where id = 'b0000000-0000-0000-0000-000000000012'$q$),

  ('preset_rounds', 'select', $q$select 1 from public.preset_rounds where id = 'b0000000-0000-0000-0000-000000000013'$q$),
  ('preset_rounds', 'insert', $q$insert into public.preset_rounds (id, owner_id, name, format, bow_type) values ('b0000000-0000-0000-0000-000000000093', 'b0000000-0000-0000-0000-000000000001', 'New Preset', 'outdoor', 'recurve')$q$),
  ('preset_rounds', 'update', $q$update public.preset_rounds set name = 'changed' where id = 'b0000000-0000-0000-0000-000000000013'$q$),
  ('preset_rounds', 'delete', $q$delete from public.preset_rounds where id = 'b0000000-0000-0000-0000-000000000013'$q$),

  ('preset_distances', 'select', $q$select 1 from public.preset_distances where id = 'b0000000-0000-0000-0000-000000000014'$q$),
  ('preset_distances', 'insert', $q$insert into public.preset_distances (id, preset_id, distance, total_ends, arrows_per_end, target_face_id, position_key) values ('b0000000-0000-0000-0000-000000000094', 'b0000000-0000-0000-0000-000000000013', 50, 6, 6, 'a1000000-0000-0000-0000-000000000001', 'b')$q$),
  ('preset_distances', 'update', $q$update public.preset_distances set distance = 50 where id = 'b0000000-0000-0000-0000-000000000014'$q$),
  ('preset_distances', 'delete', $q$delete from public.preset_distances where id = 'b0000000-0000-0000-0000-000000000014'$q$),

  ('rounds', 'select', $q$select 1 from public.rounds where id = 'b0000000-0000-0000-0000-000000000020'$q$),
  ('rounds', 'insert', $q$insert into public.rounds (id, name, round_date, format, bow_type) values ('b0000000-0000-0000-0000-000000000095', 'New Round', current_date, 'outdoor', 'recurve')$q$),
  ('rounds', 'update', $q$update public.rounds set name = 'changed' where id = 'b0000000-0000-0000-0000-000000000020'$q$),
  ('rounds', 'delete', $q$delete from public.rounds where id = 'b0000000-0000-0000-0000-000000000020'$q$),

  ('distances', 'select', $q$select 1 from public.distances where id = 'b0000000-0000-0000-0000-000000000021'$q$),
  ('distances', 'insert', $q$insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id) values ('b0000000-0000-0000-0000-000000000096', 'b0000000-0000-0000-0000-000000000020', 'b', 50, 6, 6, 'a1000000-0000-0000-0000-000000000001')$q$),
  ('distances', 'update', $q$update public.distances set distance = 50 where id = 'b0000000-0000-0000-0000-000000000021'$q$),
  ('distances', 'delete', $q$delete from public.distances where id = 'b0000000-0000-0000-0000-000000000021'$q$),

  ('shots', 'select', $q$select 1 from public.shots where distance_id = 'b0000000-0000-0000-0000-000000000021'$q$),
  ('shots', 'insert', $q$insert into public.shots (distance_id, end_number, arrow_number, shooter_id, score_str, score_int) values ('b0000000-0000-0000-0000-000000000021', 2, 1, 'b0000000-0000-0000-0000-000000000005', '9', 9)$q$),
  ('shots', 'update', $q$update public.shots set score_int = 0 where distance_id = 'b0000000-0000-0000-0000-000000000021'$q$),
  ('shots', 'delete', $q$delete from public.shots where distance_id = 'b0000000-0000-0000-0000-000000000021'$q$),

  ('round_users', 'select', $q$select 1 from public.round_users where round_id = 'b0000000-0000-0000-0000-000000000020'$q$),
  ('round_users', 'insert', $q$insert into public.round_users (id, round_id, user_id, role) values ('b0000000-0000-0000-0000-000000000097', 'b0000000-0000-0000-0000-000000000020', 'b0000000-0000-0000-0000-000000000003', 'viewer')$q$),
  ('round_users', 'update', $q$update public.round_users set role = 'editor' where id = 'b0000000-0000-0000-0000-000000000023'$q$),
  ('round_users', 'delete', $q$delete from public.round_users where id = 'b0000000-0000-0000-0000-000000000023'$q$),

  ('round_events', 'select', $q$select 1 from public.round_events where round_id = 'b0000000-0000-0000-0000-000000000020'$q$),
  ('round_events', 'insert', $q$insert into public.round_events (event_id, round_id, type, author_id, revision, name, round_date, format, bow_type) values ('b0000000-0000-0000-0000-000000000098', 'b0000000-0000-0000-0000-000000000020', 'UPDATED', 'b0000000-0000-0000-0000-000000000005', 2, 'Matrix Round', current_date, 'outdoor', 'recurve')$q$),
  ('round_events', 'update', $q$update public.round_events set name = 'changed' where event_id = 'b0000000-0000-0000-0000-000000000030'$q$),
  ('round_events', 'delete', $q$delete from public.round_events where event_id = 'b0000000-0000-0000-0000-000000000030'$q$),

  ('distance_events', 'select', $q$select 1 from public.distance_events where round_id = 'b0000000-0000-0000-0000-000000000020'$q$),
  ('distance_events', 'insert', $q$insert into public.distance_events (event_id, round_id, distance_id, type, author_id, revision, position_key, distance, is_marked, total_ends, arrows_per_end, target_face_id) values ('b0000000-0000-0000-0000-000000000099', 'b0000000-0000-0000-0000-000000000020', 'b0000000-0000-0000-0000-000000000021', 'UPDATED', 'b0000000-0000-0000-0000-000000000005', 2, 'a', 50, true, 6, 6, 'a1000000-0000-0000-0000-000000000001')$q$),
  ('distance_events', 'update', $q$update public.distance_events set distance = 50 where event_id = 'b0000000-0000-0000-0000-000000000031'$q$),
  ('distance_events', 'delete', $q$delete from public.distance_events where event_id = 'b0000000-0000-0000-0000-000000000031'$q$),

  ('shot_events', 'select', $q$select 1 from public.shot_events where distance_id = 'b0000000-0000-0000-0000-000000000021'$q$),
  ('shot_events', 'insert', $q$insert into public.shot_events (event_id, distance_id, type, author_id, revision, end_number, arrow_number, shooter_id, score_str, score_int) values ('b0000000-0000-0000-0000-00000000009a', 'b0000000-0000-0000-0000-000000000021', 'RECORDED', 'b0000000-0000-0000-0000-000000000005', 2, 1, 1, 'b0000000-0000-0000-0000-000000000005', '9', 9)$q$),
  ('shot_events', 'update', $q$update public.shot_events set score_int = 0 where event_id = 'b0000000-0000-0000-0000-000000000032'$q$),
  ('shot_events', 'delete', $q$delete from public.shot_events where event_id = 'b0000000-0000-0000-0000-000000000032'$q$);

-- 1ケースを指定アクターで実行し、'rows:N' か 'error:SQLSTATE' に正規化して返す。
-- 成功時も意図的な例外で巻き戻すため、ケースの副作用はfixtureに残らない。
create function pg_temp.rls_run(p_actor text, p_stmt text) returns text
language plpgsql
as $$
declare
  v_role text;
  v_uid uuid;
  v_rows bigint;
begin
  select db_role, uid into strict v_role, v_uid from rls_actor where actor = p_actor;
  begin
    perform set_config('request.jwt.claim.sub', coalesce(v_uid::text, ''), true);
    execute format('set local role %I', v_role);
    execute p_stmt;
    get diagnostics v_rows = row_count;
    raise exception using errcode = 'ZZ001', message = 'rows:' || v_rows;
  exception
    when sqlstate 'ZZ001' then
      return sqlerrm;
    when others then
      return 'error:' || sqlstate;
  end;
end;
$$;

create temp table rls_actual as
select s.tbl, s.op, a.actor, pg_temp.rls_run(a.actor, s.stmt) as result
from rls_stmt s
join rls_table_actor a using (tbl);

-- ============================================================
-- 期待値表: テーブル × 操作 × アクター
-- ============================================================

create temp table rls_expected (
  tbl text, op text, actor text, expected text,
  primary key (tbl, op, actor)
);
insert into rls_expected (tbl, op, actor, expected) values
  ('users',              'select',  'self',        'rows:1'),
  ('users',              'select',  'other',       'rows:1'),
  ('users',              'select',  'anon',        'error:42501'),
  ('users',              'insert',  'self',        'error:42501'),
  ('users',              'insert',  'other',       'error:42501'),
  ('users',              'insert',  'anon',        'error:42501'),
  ('users',              'update',  'self',        'rows:1'),
  ('users',              'update',  'other',       'rows:0'),
  ('users',              'update',  'anon',        'error:42501'),
  ('users',              'delete',  'self',        'rows:1'),
  ('users',              'delete',  'other',       'rows:0'),
  ('users',              'delete',  'anon',        'error:42501'),
  ('target_faces',       'select',  'owner',       'rows:1'),
  ('target_faces',       'select',  'other',       'rows:1'),
  ('target_faces',       'select',  'anon',        'error:42501'),
  ('target_faces',       'insert',  'owner',       'rows:1'),
  ('target_faces',       'insert',  'other',       'error:42501'),
  ('target_faces',       'insert',  'anon',        'error:42501'),
  ('target_faces',       'update',  'owner',       'rows:1'),
  ('target_faces',       'update',  'other',       'rows:0'),
  ('target_faces',       'update',  'anon',        'error:42501'),
  ('target_faces',       'delete',  'owner',       'rows:1'),
  ('target_faces',       'delete',  'other',       'rows:0'),
  ('target_faces',       'delete',  'anon',        'error:42501'),
  ('target_face_spots',  'select',  'owner',       'rows:1'),
  ('target_face_spots',  'select',  'other',       'rows:1'),
  ('target_face_spots',  'select',  'anon',        'error:42501'),
  ('target_face_spots',  'insert',  'owner',       'rows:1'),
  ('target_face_spots',  'insert',  'other',       'error:42501'),
  ('target_face_spots',  'insert',  'anon',        'error:42501'),
  ('target_face_spots',  'update',  'owner',       'rows:1'),
  ('target_face_spots',  'update',  'other',       'rows:0'),
  ('target_face_spots',  'update',  'anon',        'error:42501'),
  ('target_face_spots',  'delete',  'owner',       'rows:1'),
  ('target_face_spots',  'delete',  'other',       'rows:0'),
  ('target_face_spots',  'delete',  'anon',        'error:42501'),
  ('target_face_rings',  'select',  'owner',       'rows:1'),
  ('target_face_rings',  'select',  'other',       'rows:1'),
  ('target_face_rings',  'select',  'anon',        'error:42501'),
  ('target_face_rings',  'insert',  'owner',       'rows:1'),
  ('target_face_rings',  'insert',  'other',       'error:42501'),
  ('target_face_rings',  'insert',  'anon',        'error:42501'),
  ('target_face_rings',  'update',  'owner',       'rows:1'),
  ('target_face_rings',  'update',  'other',       'rows:0'),
  ('target_face_rings',  'update',  'anon',        'error:42501'),
  ('target_face_rings',  'delete',  'owner',       'rows:1'),
  ('target_face_rings',  'delete',  'other',       'rows:0'),
  ('target_face_rings',  'delete',  'anon',        'error:42501'),
  ('preset_rounds',      'select',  'owner',       'rows:1'),
  ('preset_rounds',      'select',  'other',       'rows:1'),
  ('preset_rounds',      'select',  'anon',        'error:42501'),
  ('preset_rounds',      'insert',  'owner',       'rows:1'),
  ('preset_rounds',      'insert',  'other',       'error:42501'),
  ('preset_rounds',      'insert',  'anon',        'error:42501'),
  ('preset_rounds',      'update',  'owner',       'rows:1'),
  ('preset_rounds',      'update',  'other',       'rows:0'),
  ('preset_rounds',      'update',  'anon',        'error:42501'),
  ('preset_rounds',      'delete',  'owner',       'rows:1'),
  ('preset_rounds',      'delete',  'other',       'rows:0'),
  ('preset_rounds',      'delete',  'anon',        'error:42501'),
  ('preset_distances',   'select',  'owner',       'rows:1'),
  ('preset_distances',   'select',  'other',       'rows:1'),
  ('preset_distances',   'select',  'anon',        'error:42501'),
  ('preset_distances',   'insert',  'owner',       'rows:1'),
  ('preset_distances',   'insert',  'other',       'error:42501'),
  ('preset_distances',   'insert',  'anon',        'error:42501'),
  ('preset_distances',   'update',  'owner',       'rows:1'),
  ('preset_distances',   'update',  'other',       'rows:0'),
  ('preset_distances',   'update',  'anon',        'error:42501'),
  ('preset_distances',   'delete',  'owner',       'rows:1'),
  ('preset_distances',   'delete',  'other',       'rows:0'),
  ('preset_distances',   'delete',  'anon',        'error:42501'),
  ('rounds',             'select',  'editor',      'rows:1'),
  ('rounds',             'select',  'viewer',      'rows:1'),
  ('rounds',             'select',  'non_member',  'rows:0'),
  ('rounds',             'select',  'anon',        'error:42501'),
  ('rounds',             'insert',  'editor',      'error:42501'),
  ('rounds',             'insert',  'viewer',      'error:42501'),
  ('rounds',             'insert',  'non_member',  'error:42501'),
  ('rounds',             'insert',  'anon',        'error:42501'),
  ('rounds',             'update',  'editor',      'error:42501'),
  ('rounds',             'update',  'viewer',      'error:42501'),
  ('rounds',             'update',  'non_member',  'error:42501'),
  ('rounds',             'update',  'anon',        'error:42501'),
  ('rounds',             'delete',  'editor',      'error:42501'),
  ('rounds',             'delete',  'viewer',      'error:42501'),
  ('rounds',             'delete',  'non_member',  'error:42501'),
  ('rounds',             'delete',  'anon',        'error:42501'),
  ('distances',          'select',  'editor',      'rows:1'),
  ('distances',          'select',  'viewer',      'rows:1'),
  ('distances',          'select',  'non_member',  'rows:0'),
  ('distances',          'select',  'anon',        'error:42501'),
  ('distances',          'insert',  'editor',      'error:42501'),
  ('distances',          'insert',  'viewer',      'error:42501'),
  ('distances',          'insert',  'non_member',  'error:42501'),
  ('distances',          'insert',  'anon',        'error:42501'),
  ('distances',          'update',  'editor',      'error:42501'),
  ('distances',          'update',  'viewer',      'error:42501'),
  ('distances',          'update',  'non_member',  'error:42501'),
  ('distances',          'update',  'anon',        'error:42501'),
  ('distances',          'delete',  'editor',      'error:42501'),
  ('distances',          'delete',  'viewer',      'error:42501'),
  ('distances',          'delete',  'non_member',  'error:42501'),
  ('distances',          'delete',  'anon',        'error:42501'),
  ('shots',              'select',  'editor',      'rows:1'),
  ('shots',              'select',  'viewer',      'rows:1'),
  ('shots',              'select',  'non_member',  'rows:0'),
  ('shots',              'select',  'anon',        'error:42501'),
  ('shots',              'insert',  'editor',      'error:42501'),
  ('shots',              'insert',  'viewer',      'error:42501'),
  ('shots',              'insert',  'non_member',  'error:42501'),
  ('shots',              'insert',  'anon',        'error:42501'),
  ('shots',              'update',  'editor',      'error:42501'),
  ('shots',              'update',  'viewer',      'error:42501'),
  ('shots',              'update',  'non_member',  'error:42501'),
  ('shots',              'update',  'anon',        'error:42501'),
  ('shots',              'delete',  'editor',      'error:42501'),
  ('shots',              'delete',  'viewer',      'error:42501'),
  ('shots',              'delete',  'non_member',  'error:42501'),
  ('shots',              'delete',  'anon',        'error:42501'),
  ('round_users',        'select',  'editor',      'rows:2'),
  ('round_users',        'select',  'viewer',      'rows:2'),
  ('round_users',        'select',  'non_member',  'rows:0'),
  ('round_users',        'select',  'anon',        'error:42501'),
  ('round_users',        'insert',  'editor',      'rows:1'),
  ('round_users',        'insert',  'viewer',      'error:42501'),
  ('round_users',        'insert',  'non_member',  'error:42501'),
  ('round_users',        'insert',  'anon',        'error:42501'),
  ('round_users',        'update',  'editor',      'rows:1'),
  ('round_users',        'update',  'viewer',      'rows:0'),
  ('round_users',        'update',  'non_member',  'rows:0'),
  ('round_users',        'update',  'anon',        'error:42501'),
  ('round_users',        'delete',  'editor',      'rows:1'),
  ('round_users',        'delete',  'viewer',      'rows:0'),
  ('round_users',        'delete',  'non_member',  'rows:0'),
  ('round_users',        'delete',  'anon',        'error:42501'),
  ('round_events',       'select',  'editor',      'rows:1'),
  ('round_events',       'select',  'viewer',      'rows:1'),
  ('round_events',       'select',  'non_member',  'rows:0'),
  ('round_events',       'select',  'anon',        'error:42501'),
  ('round_events',       'insert',  'editor',      'error:42501'),
  ('round_events',       'insert',  'viewer',      'error:42501'),
  ('round_events',       'insert',  'non_member',  'error:42501'),
  ('round_events',       'insert',  'anon',        'error:42501'),
  ('round_events',       'update',  'editor',      'error:42501'),
  ('round_events',       'update',  'viewer',      'error:42501'),
  ('round_events',       'update',  'non_member',  'error:42501'),
  ('round_events',       'update',  'anon',        'error:42501'),
  ('round_events',       'delete',  'editor',      'error:42501'),
  ('round_events',       'delete',  'viewer',      'error:42501'),
  ('round_events',       'delete',  'non_member',  'error:42501'),
  ('round_events',       'delete',  'anon',        'error:42501'),
  ('distance_events',    'select',  'editor',      'rows:1'),
  ('distance_events',    'select',  'viewer',      'rows:1'),
  ('distance_events',    'select',  'non_member',  'rows:0'),
  ('distance_events',    'select',  'anon',        'error:42501'),
  ('distance_events',    'insert',  'editor',      'error:42501'),
  ('distance_events',    'insert',  'viewer',      'error:42501'),
  ('distance_events',    'insert',  'non_member',  'error:42501'),
  ('distance_events',    'insert',  'anon',        'error:42501'),
  ('distance_events',    'update',  'editor',      'error:42501'),
  ('distance_events',    'update',  'viewer',      'error:42501'),
  ('distance_events',    'update',  'non_member',  'error:42501'),
  ('distance_events',    'update',  'anon',        'error:42501'),
  ('distance_events',    'delete',  'editor',      'error:42501'),
  ('distance_events',    'delete',  'viewer',      'error:42501'),
  ('distance_events',    'delete',  'non_member',  'error:42501'),
  ('distance_events',    'delete',  'anon',        'error:42501'),
  ('shot_events',        'select',  'editor',      'rows:1'),
  ('shot_events',        'select',  'viewer',      'rows:1'),
  ('shot_events',        'select',  'non_member',  'rows:0'),
  ('shot_events',        'select',  'anon',        'error:42501'),
  ('shot_events',        'insert',  'editor',      'error:42501'),
  ('shot_events',        'insert',  'viewer',      'error:42501'),
  ('shot_events',        'insert',  'non_member',  'error:42501'),
  ('shot_events',        'insert',  'anon',        'error:42501'),
  ('shot_events',        'update',  'editor',      'error:42501'),
  ('shot_events',        'update',  'viewer',      'error:42501'),
  ('shot_events',        'update',  'non_member',  'error:42501'),
  ('shot_events',        'update',  'anon',        'error:42501'),
  ('shot_events',        'delete',  'editor',      'error:42501'),
  ('shot_events',        'delete',  'viewer',      'error:42501'),
  ('shot_events',        'delete',  'non_member',  'error:42501'),
  ('shot_events',        'delete',  'anon',        'error:42501')
;

select is_empty(
  $$select coalesce(a.tbl, e.tbl) as tbl, coalesce(a.op, e.op) as op, coalesce(a.actor, e.actor) as actor,
      a.result as actual, e.expected
    from rls_actual a
    full join rls_expected e on (a.tbl, a.op, a.actor) = (e.tbl, e.op, e.actor)
    where a.result is distinct from e.expected$$,
  'RLSマトリクスの実測が期待値表と全件一致する'
);

select is_empty(
  $$select c.relname as tbl, o.op, coalesce(a.actor, '(アクター集合が未定義)') as actor
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('select'), ('insert'), ('update'), ('delete')) as o(op)
    left join rls_table_actor a on a.tbl = c.relname
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and not exists (
        select 1 from rls_expected e
        where e.tbl = c.relname and e.op = o.op and e.actor is not distinct from a.actor
      )$$,
  'publicの全テーブル × 4操作 × 全アクターが期待値表に含まれる'
);

select is_empty(
  $$select e.tbl, e.op, e.actor
    from rls_expected e
    where not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join rls_table_actor a on a.tbl = c.relname
      cross join (values ('select'), ('insert'), ('update'), ('delete')) as o(op)
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and c.relname = e.tbl and a.actor = e.actor and o.op = e.op
    )$$,
  '期待値表に存在しないテーブル・アクターの行が残っていない'
);

select is_empty(
  $$select a.actor as actor, '(テーブルへの対応付けなし)' as tbl
    from rls_actor a
    where a.actor <> 'admin' and not exists (select 1 from rls_table_actor t where t.actor = a.actor)
    union all
    select '(アクター集合が未定義)', c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and not exists (select 1 from rls_table_actor t where t.tbl = c.relname)$$,
  '全アクターが1つ以上のテーブルに対応付けられ、publicの全テーブルが1つ以上のアクターを持つ'
);

select is_empty(
  $$select tbl, op, actor, expected from rls_expected
    where expected like 'error:%' and expected <> 'error:42501'$$,
  '期待値のエラーは権限不足・RLS違反（42501）だけで、検証SQLの不備によるエラーを含まない'
);

-- アクターを問わず検証SQLがfixtureに対して成立する（接続ロールでは必ず1行以上に作用する）ことを確認する。
-- rows:0 になる期待値が、SQLの対象行の誤りではなくRLSによるものだと言える根拠になる。
select is_empty(
  $$select tbl, op, result
    from (select tbl, op, pg_temp.rls_run('admin', stmt) as result from rls_stmt) r
    where result !~ '^rows:[1-9]'$$,
  '全ての検証SQLはRLS対象外の接続ロールで1行以上に作用する'
);

-- 検証対象ロール（anon・authenticated）と内部ロール以外に、publicのテーブルへのDML権限が付いていない。
-- anon・authenticatedのテーブル権限は、下のテーブル権限の期待値表がPUBLIC経由の実効権限を含めて固定する。
-- ここは、期待値表に現れない別のロールへDML権限が付くことを検出する。
-- service_roleの権限は検証対象外とし、DML権限が付いていないことだけを確認する。
select is_empty(
  $$select c.relname as tbl, g.role_name, a.privilege_type
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    cross join lateral (
      select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as role_name
    ) g
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      and g.role_name not in (select role_name from rls_role)$$,
  'publicの全テーブルのDML権限は、検証対象ロールと内部ロールにしか付いていない'
);

-- ============================================================
-- テーブル権限: テーブル × ロール × 権限
-- ============================================================
-- RLSを通らない権限（TRUNCATE, REFERENCES, TRIGGERなど）と、ポリシーのない操作のDML権限は付けない。
-- anonには何も付けず、authenticatedにはSELECTと、書き込みポリシーのある操作のDMLだけを付ける。
-- has_table_privilegeはPUBLIC経由を含む実効権限を返す。
-- 対象はテーブル(r, p)に加えて、同じテーブル権限でPostgRESTへ公開され得るview(v)・materialized view(m)・foreign table(f)とする。
-- シーケンス(S)は別の権限体系（USAGE/SELECT/UPDATE）でテーブル権限の対象外のため含めない。

create temp table rls_priv_spec (
  tbl text, role_name text references rls_role,
  p_select boolean, p_insert boolean, p_update boolean, p_delete boolean,
  p_truncate boolean, p_references boolean, p_trigger boolean,
  primary key (tbl, role_name)
);
insert into rls_priv_spec (tbl, role_name, p_select, p_insert, p_update, p_delete, p_truncate, p_references, p_trigger) values
  ('users',             'anon',          false, false, false, false, false, false, false),
  ('users',             'authenticated', true,  false, true,  true,  false, false, false),
  ('target_faces',      'anon',          false, false, false, false, false, false, false),
  ('target_faces',      'authenticated', true,  true,  true,  true,  false, false, false),
  ('target_face_spots', 'anon',          false, false, false, false, false, false, false),
  ('target_face_spots', 'authenticated', true,  true,  true,  true,  false, false, false),
  ('target_face_rings', 'anon',          false, false, false, false, false, false, false),
  ('target_face_rings', 'authenticated', true,  true,  true,  true,  false, false, false),
  ('preset_rounds',     'anon',          false, false, false, false, false, false, false),
  ('preset_rounds',     'authenticated', true,  true,  true,  true,  false, false, false),
  ('preset_distances',  'anon',          false, false, false, false, false, false, false),
  ('preset_distances',  'authenticated', true,  true,  true,  true,  false, false, false),
  ('rounds',            'anon',          false, false, false, false, false, false, false),
  ('rounds',            'authenticated', true,  false, false, false, false, false, false),
  ('distances',         'anon',          false, false, false, false, false, false, false),
  ('distances',         'authenticated', true,  false, false, false, false, false, false),
  ('shots',             'anon',          false, false, false, false, false, false, false),
  ('shots',             'authenticated', true,  false, false, false, false, false, false),
  ('round_users',       'anon',          false, false, false, false, false, false, false),
  ('round_users',       'authenticated', true,  true,  true,  true,  false, false, false),
  ('round_events',      'anon',          false, false, false, false, false, false, false),
  ('round_events',      'authenticated', true,  false, false, false, false, false, false),
  ('distance_events',   'anon',          false, false, false, false, false, false, false),
  ('distance_events',   'authenticated', true,  false, false, false, false, false, false),
  ('shot_events',       'anon',          false, false, false, false, false, false, false),
  ('shot_events',       'authenticated', true,  false, false, false, false, false, false);

create temp table rls_priv_expected as
select s.tbl, s.role_name, p.priv, p.allowed
from rls_priv_spec s
cross join lateral (values
  ('select', s.p_select), ('insert', s.p_insert), ('update', s.p_update), ('delete', s.p_delete),
  ('truncate', s.p_truncate), ('references', s.p_references), ('trigger', s.p_trigger)
) as p(priv, allowed);

-- 実測は、後でテーブルを作る検証より前に確定させる（作成したテーブルが網羅性の判定に混ざらないようにする）。
create temp table rls_priv_actual as
select c.relname as tbl, r.role_name, p.priv,
  has_table_privilege(r.role_name, c.oid, p.priv) as allowed
from pg_class c
cross join (select role_name from rls_role where kind = 'target') as r
cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger')) as p(priv)
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f');

select is_empty(
  $$select coalesce(a.tbl, e.tbl) as tbl, coalesce(a.role_name, e.role_name) as role_name,
      coalesce(a.priv, e.priv) as priv, a.allowed as actual, e.allowed as expected
    from rls_priv_actual a
    full join rls_priv_expected e on (a.tbl, a.role_name, a.priv) = (e.tbl, e.role_name, e.priv)
    where a.allowed is distinct from e.allowed$$,
  'publicの全テーブル × anon/authenticated × 7権限の実効権限が期待値表と全件一致する'
);

select is_empty(
  $$select a.tbl, a.role_name, a.priv
    from rls_priv_actual a
    where not exists (
      select 1 from rls_priv_expected e
      where e.tbl = a.tbl and e.role_name = a.role_name and e.priv = a.priv
    )$$,
  'publicの全テーブル × ロール × 権限が権限の期待値表に含まれる'
);

select is_empty(
  $$select e.tbl, e.role_name, e.priv
    from rls_priv_expected e
    where not exists (
      select 1 from rls_priv_actual a
      where a.tbl = e.tbl and a.role_name = e.role_name and a.priv = e.priv
    )$$,
  '権限の期待値表に存在しないテーブルの行が残っていない'
);

-- 上の表が扱う7権限以外（MAINTAINなど）や、GRANT OPTIONが、anon・authenticated・PUBLICに付いていない。
select is_empty(
  $$select c.relname as tbl, g.role_name, a.privilege_type, a.is_grantable
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    cross join lateral (
      select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as role_name
    ) g
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and g.role_name in ('anon', 'authenticated', 'PUBLIC')
      and (a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
        or a.is_grantable)$$,
  'anon・authenticated・PUBLICに、権限表の対象外の権限とGRANT OPTIONが付いていない'
);

-- has_table_privilegeはテーブル単位の権限だけを判定するため、列単位の権限は別に確認する。
select is_empty(
  $$select c.relname as tbl, a.attname as col
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and a.attnum > 0 and not a.attisdropped and a.attacl is not null$$,
  'publicの全テーブルに列単位の権限が付いていない'
);

-- ============================================================
-- 関数の実行権限: 関数 × ロール
-- ============================================================

create temp view rls_fn_actual as
select
  'public.' || p.proname || '(' || coalesce((
    select string_agg(format_type(t.typ, null), ',' order by t.ord)
    from unnest(p.proargtypes::oid[]) with ordinality as t(typ, ord)
  ), '') || ')' as signature,
  r.role_name,
  has_function_privilege(r.role_name, p.oid, 'execute') as can_execute
from pg_proc p
cross join (select role_name from rls_role where kind = 'target') as r
where p.pronamespace = 'public'::regnamespace;

-- 期待値の方針:
--   RPCとRLSポリシーのヘルパー: authenticatedだけtrue。anonはfalse。
--   トリガー関数（handle_new_user, set_updated_at）: EXECUTEはCREATE TRIGGERの時点で検査されるため、どちらもfalse。
-- 新しい関数を追加したら、PUBLICからREVOKEし、この表に行を追加する。
create temp table rls_fn_expected (
  signature text, role_name text, can_execute boolean,
  primary key (signature, role_name)
);
insert into rls_fn_expected (signature, role_name, can_execute) values
  ('public.clear_shots(jsonb)',                                                       'anon',          false),
  ('public.clear_shots(jsonb)',                                                       'authenticated', true),
  ('public.create_distance(uuid,uuid,uuid,text,bigint,bigint,bigint,uuid,boolean)',   'anon',          false),
  ('public.create_distance(uuid,uuid,uuid,text,bigint,bigint,bigint,uuid,boolean)',   'authenticated', true),
  ('public.create_round(uuid,uuid,text,date,text,text,jsonb)',                        'anon',          false),
  ('public.create_round(uuid,uuid,text,date,text,text,jsonb)',                        'authenticated', true),
  ('public.disable_distance(uuid,uuid)',                                              'anon',          false),
  ('public.disable_distance(uuid,uuid)',                                              'authenticated', true),
  ('public.disable_round(uuid,uuid)',                                                 'anon',          false),
  ('public.disable_round(uuid,uuid)',                                                 'authenticated', true),
  ('public.handle_new_user()',                                                        'anon',          false),
  ('public.handle_new_user()',                                                        'authenticated', false),
  ('public.is_round_editor(uuid)',                                                    'anon',          false),
  ('public.is_round_editor(uuid)',                                                    'authenticated', true),
  ('public.is_round_member(uuid)',                                                    'anon',          false),
  ('public.is_round_member(uuid)',                                                    'authenticated', true),
  ('public.record_shots(jsonb)',                                                      'anon',          false),
  ('public.record_shots(jsonb)',                                                      'authenticated', true),
  ('public.save_round_as_preset(text,text,text,jsonb)',                               'anon',          false),
  ('public.save_round_as_preset(text,text,text,jsonb)',                               'authenticated', true),
  ('public.set_updated_at()',                                                         'anon',          false),
  ('public.set_updated_at()',                                                         'authenticated', false),
  ('public.update_distance(uuid,uuid,bigint,bigint,bigint,uuid,boolean)',             'anon',          false),
  ('public.update_distance(uuid,uuid,bigint,bigint,bigint,uuid,boolean)',             'authenticated', true),
  ('public.update_round(uuid,uuid,text,date,text,text)',                              'anon',          false),
  ('public.update_round(uuid,uuid,text,date,text,text)',                              'authenticated', true)
;

select is_empty(
  $$select coalesce(a.signature, e.signature) as signature, coalesce(a.role_name, e.role_name) as role_name,
      a.can_execute as actual, e.can_execute as expected
    from rls_fn_actual a
    full join rls_fn_expected e on (a.signature, a.role_name) = (e.signature, e.role_name)
    where a.can_execute is distinct from e.can_execute$$,
  'publicスキーマの全関数 × anon/authenticatedの実行権限が期待値表と全件一致する'
);

select is_empty(
  $$select a.signature, a.role_name
    from rls_fn_actual a
    where not exists (
      select 1 from rls_fn_expected e
      where e.signature = a.signature and e.role_name = a.role_name
    )$$,
  'publicスキーマの全関数 × ロールが実行権限の期待値表に含まれる'
);

select is_empty(
  $$select e.signature, e.role_name
    from rls_fn_expected e
    where not exists (
      select 1 from rls_fn_actual a
      where a.signature = e.signature and a.role_name = e.role_name
    )$$,
  '実行権限の期待値表に存在しない関数の行が残っていない'
);

-- 検証対象外のロールに、publicの関数のEXECUTEが付いていない。proaclがnullの関数は既定権限で判定する。
-- PUBLICは上の実測ではanon・authenticatedへの実効権限として現れるため、内部ロールとして許容している。
-- PUBLICのEXECUTEは次の検証で別に禁止する。
select is_empty(
  $$select p.proname, g.role_name
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    cross join lateral (
      select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as role_name
    ) g
    where p.pronamespace = 'public'::regnamespace and a.privilege_type = 'EXECUTE'
      and g.role_name not in (select role_name from rls_role)$$,
  'publicの全関数のEXECUTEは、検証対象ロールと内部ロールにしか付いていない'
);

-- PUBLICにpublicの全関数のEXECUTEが付いていない。
-- 関数の作成時に自動で付くPUBLICのEXECUTEは、REVOKEし忘れるとanon・authenticatedへの実効権限になる。
-- 新しい関数でREVOKEが漏れた場合は、この検証と期待値表の網羅性の検証が落ちる。
select is_empty(
  $$select p.proname
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.pronamespace = 'public'::regnamespace and a.privilege_type = 'EXECUTE' and a.grantee = 0$$,
  'publicの全関数にPUBLICのEXECUTEが付いていない'
);

-- ============================================================
-- 新規テーブルへの自動付与: postgresロールの既定権限
-- ============================================================
-- postgresロールがpublicに作るテーブルにanon・authenticatedへの権限が自動で付かないことを確認する。
-- 他のテーブル単位の検証が終わった後で作成し、最後のrollbackで消える。

create table public.rls_matrix_probe (id int primary key);

select is(
  (select relowner::regrole::text from pg_class where oid = 'public.rls_matrix_probe'::regclass),
  'postgres',
  '検証用テーブルはpostgresロールが作成した（postgresの既定権限を検証している）'
);

select is_empty(
  $$select r.role_name, p.priv
    from (select role_name from rls_role where kind = 'target') r
    cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger')) as p(priv)
    where has_table_privilege(r.role_name, 'public.rls_matrix_probe'::regclass, p.priv)$$,
  '新規テーブルにanon・authenticatedの権限が自動で付かない'
);

select is_empty(
  $$select g.role_name, a.privilege_type
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    cross join lateral (
      select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as role_name
    ) g
    where c.oid = 'public.rls_matrix_probe'::regclass
      and g.role_name in ('anon', 'authenticated', 'PUBLIC')$$,
  '新規テーブルのACLにanon・authenticated・PUBLICが含まれない（MAINTAINなどの権限も付かない）'
);

select * from finish();

rollback;
