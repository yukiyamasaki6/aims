begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

alter table distances validate constraint distances_distance_positive;
alter table distances validate constraint distances_total_ends_positive;
alter table distances validate constraint distances_arrows_per_end_positive;

alter table round_preset_distances validate constraint round_preset_distances_distance_positive;
alter table round_preset_distances validate constraint round_preset_distances_total_ends_positive;
alter table round_preset_distances validate constraint round_preset_distances_arrows_per_end_positive;

commit;
