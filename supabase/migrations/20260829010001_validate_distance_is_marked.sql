begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

alter table distances validate constraint distances_marked_requires_distance;
alter table round_preset_distances validate constraint round_preset_distances_marked_requires_distance;

commit;
