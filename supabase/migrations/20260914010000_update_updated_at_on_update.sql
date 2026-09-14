begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

-- updated_at is physical write time, so keep it independent from logical event times.
drop trigger if exists set_users_updated_at on users;
create trigger set_users_updated_at
  before update on users
  for each row
  execute function set_updated_at();

drop trigger if exists set_rounds_updated_at on rounds;
create trigger set_rounds_updated_at
  before update on rounds
  for each row
  execute function set_updated_at();

drop trigger if exists set_round_users_updated_at on round_users;
create trigger set_round_users_updated_at
  before update on round_users
  for each row
  execute function set_updated_at();

drop trigger if exists set_distances_updated_at on distances;
create trigger set_distances_updated_at
  before update on distances
  for each row
  execute function set_updated_at();

drop trigger if exists set_shots_updated_at on shots;
create trigger set_shots_updated_at
  before update on shots
  for each row
  execute function set_updated_at();

drop trigger if exists set_target_faces_updated_at on target_faces;
create trigger set_target_faces_updated_at
  before update on target_faces
  for each row
  execute function set_updated_at();

drop trigger if exists set_target_face_spots_updated_at on target_face_spots;
create trigger set_target_face_spots_updated_at
  before update on target_face_spots
  for each row
  execute function set_updated_at();

drop trigger if exists set_target_face_rings_updated_at on target_face_rings;
create trigger set_target_face_rings_updated_at
  before update on target_face_rings
  for each row
  execute function set_updated_at();

drop trigger if exists set_round_presets_updated_at on round_presets;
create trigger set_round_presets_updated_at
  before update on round_presets
  for each row
  execute function set_updated_at();

drop trigger if exists set_round_preset_distances_updated_at on round_preset_distances;
create trigger set_round_preset_distances_updated_at
  before update on round_preset_distances
  for each row
  execute function set_updated_at();

commit;
