begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- ============================================================
-- distances / round_preset_distances:
-- distance・total_ends・arrows_per_endが1以上の整数であることをDB側でも
-- 保証する。これまではクライアント側（DistanceEditFields）の検証にしか
-- 存在せず、これらのテーブルはRPCを経由せずクライアントから直接
-- insert/updateされる（RLSのWITH CHECKもis_round_editor等の権限しか
-- 見ていない）ため、API経由で0や負の値を挿入できてしまっていた。
-- ============================================================

alter table distances
  add constraint distances_distance_positive
    check (distance is null or distance >= 1) not valid;
alter table distances
  add constraint distances_total_ends_positive
    check (total_ends >= 1) not valid;
alter table distances
  add constraint distances_arrows_per_end_positive
    check (arrows_per_end >= 1) not valid;

alter table round_preset_distances
  add constraint round_preset_distances_distance_positive
    check (distance is null or distance >= 1) not valid;
alter table round_preset_distances
  add constraint round_preset_distances_total_ends_positive
    check (total_ends >= 1) not valid;
alter table round_preset_distances
  add constraint round_preset_distances_arrows_per_end_positive
    check (arrows_per_end >= 1) not valid;

commit;
