set lock_timeout = '1s';
set statement_timeout = '5s';

create unique index concurrently if not exists distances_round_id_distance_number_key
  on public.distances (round_id, distance_number);
