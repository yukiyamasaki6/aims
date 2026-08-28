begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- ============================================================
-- Columns
-- ============================================================

alter table rounds add column if not exists format text not null
  check (format in ('outdoor', 'indoor', 'field'));
alter table rounds add column if not exists bow_type text not null
  check (bow_type in ('recurve', 'compound', 'barebow'));

alter table distances add column if not exists target_face_id uuid not null;

alter table distances
  add constraint distances_target_face_id_fkey
    foreign key (target_face_id) references target_faces (id)
    not valid;

-- ============================================================
-- create_round RPCをformat・bow_type・distance毎のtarget_face_idに対応させる。
-- 運用開始前のため旧シグネチャは残さず置き換える。
-- ============================================================

drop function if exists create_round(text, date, jsonb);

create or replace function create_round(
  p_name text,
  p_round_date date,
  p_format text,
  p_bow_type text,
  p_distances jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round_id uuid := gen_random_uuid();
  v_distance jsonb;
  v_distance_number bigint := 0;
begin
  insert into round_users (round_id, user_id, role)
  values (v_round_id, auth.uid(), 'editor');

  insert into rounds (id, name, round_date, format, bow_type)
  values (v_round_id, p_name, p_round_date, p_format, p_bow_type);

  for v_distance in select * from jsonb_array_elements(p_distances)
  loop
    v_distance_number := v_distance_number + 1;
    insert into distances (round_id, distance_number, distance, total_ends, arrows_per_end, target_face_id)
    values (
      v_round_id,
      v_distance_number,
      (v_distance ->> 'distance')::bigint,
      (v_distance ->> 'total_ends')::bigint,
      (v_distance ->> 'arrows_per_end')::bigint,
      (v_distance ->> 'target_face_id')::uuid
    );
  end loop;

  return v_round_id;
end;
$$;

grant execute on function create_round(text, date, text, text, jsonb) to authenticated;

commit;
