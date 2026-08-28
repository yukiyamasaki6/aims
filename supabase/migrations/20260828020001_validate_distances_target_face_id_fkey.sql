begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

alter table distances
  validate constraint distances_target_face_id_fkey;

commit;
