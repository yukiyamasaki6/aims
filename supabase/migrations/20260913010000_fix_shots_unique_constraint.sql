begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- ============================================================
-- shots.unique(distance_id, user_id, end_number, arrow_number) は誤り。
-- 1本の矢に対する記録は射手(user_id、後続マイグレーションでshooter_idへ改名)に関わらず1行であるべきで、
-- 正しい一意制約は (distance_id, end_number, arrow_number) のみ。
-- ============================================================

alter table shots
  drop constraint shots_distance_id_user_id_end_number_arrow_number_key;

alter table shots
  add constraint shots_distance_id_end_number_arrow_number_key
    unique using index shots_distance_id_end_number_arrow_number_key;

commit;
