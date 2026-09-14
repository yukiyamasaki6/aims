set lock_timeout = '1s';
set statement_timeout = '5s';

create unique index concurrently if not exists round_preset_distances_preset_id_distance_number_key
  on public.round_preset_distances (preset_id, distance_number);
