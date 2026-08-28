begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- ============================================================
-- target_faces.size: 的紙の実サイズ（cm）。
--
-- target_face_ringsの最外リング半径から的のサイズを逆算すると、6点的
-- （得点帯が中心の一部にしか印刷されず、外側は無地の余白になる的）では
-- 実際の的紙サイズより小さい値になってしまう（例: 6点的アウトドア80cmは
-- 最外リング径48cmだが、的紙自体は80cm）。リングジオメトリとは独立に
-- 実サイズを持つことで、この不一致を解消する。
-- ============================================================

alter table target_faces add column if not exists size bigint;

update target_faces set size = 122 where id = 'a1000000-0000-0000-0000-000000000001';
update target_faces set size = 80  where id = 'a1000000-0000-0000-0000-000000000002';
update target_faces set size = 80  where id = 'a1000000-0000-0000-0000-000000000003';
update target_faces set size = 60  where id = 'a1000000-0000-0000-0000-000000000004';
update target_faces set size = 60  where id = 'a1000000-0000-0000-0000-000000000005';
update target_faces set size = 60  where id = 'a1000000-0000-0000-0000-000000000006';
update target_faces set size = 40  where id = 'a1000000-0000-0000-0000-000000000007';
update target_faces set size = 40  where id = 'a1000000-0000-0000-0000-000000000008';
update target_faces set size = 40  where id = 'a1000000-0000-0000-0000-000000000009';
update target_faces set size = 80  where id = 'a1000000-0000-0000-0000-000000000010';
update target_faces set size = 60  where id = 'a1000000-0000-0000-0000-000000000011';
update target_faces set size = 40  where id = 'a1000000-0000-0000-0000-000000000012';
update target_faces set size = 20  where id = 'a1000000-0000-0000-0000-000000000013';

alter table target_faces
  add constraint target_faces_size_not_null check (size is not null) not valid;

commit;
