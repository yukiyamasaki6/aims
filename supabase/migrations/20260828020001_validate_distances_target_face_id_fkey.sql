begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

alter table distances
  validate constraint distances_target_face_id_fkey;

alter table rounds
  validate constraint rounds_format_not_null;
alter table rounds
  validate constraint rounds_bow_type_not_null;
alter table distances
  validate constraint distances_target_face_id_not_null;

-- 検証済みのCHECK制約があるとSET NOT NULLはテーブルの再スキャンをスキップできるため、
-- 通常のNOT NULL制約に置き換えて一時的なCHECK制約を整理する。
alter table rounds alter column format set not null;
alter table rounds alter column bow_type set not null;
alter table distances alter column target_face_id set not null;

alter table rounds drop constraint rounds_format_not_null;
alter table rounds drop constraint rounds_bow_type_not_null;
alter table distances drop constraint distances_target_face_id_not_null;

commit;
