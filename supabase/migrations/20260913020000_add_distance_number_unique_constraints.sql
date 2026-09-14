begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- ============================================================
-- distances.distance_number はラウンド内での距離の順番を表す値であり、
-- 同一round_id内で重複してはならないが、一意制約が無く重複挿入を防げて
-- いなかった。round_preset_distances.distance_numberも同様。
-- ============================================================

alter table distances
  add constraint distances_round_id_distance_number_key
    unique using index distances_round_id_distance_number_key;

alter table round_preset_distances
  add constraint round_preset_distances_preset_id_distance_number_key
    unique using index round_preset_distances_preset_id_distance_number_key;

commit;
