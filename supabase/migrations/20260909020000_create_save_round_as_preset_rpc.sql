begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- ラウンド取得・距離取得・プリセット作成・距離複製を1つの関数にまとめ、原子的に
-- 行う。別々のSupabase呼び出しに分けると、距離のinsertが失敗した場合に距離を
-- 持たないプリセットだけが残るおそれがあり、アプリ側で手動delete処理が必要
-- だった。SECURITY INVOKERのため、内部のSELECT/INSERTは呼び出しユーザーの
-- RLSをそのまま受ける。
create or replace function save_round_as_preset(p_round_id uuid, p_name text)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_format text;
  v_bow_type text;
  v_preset_id uuid;
begin
  select format, bow_type into v_format, v_bow_type
  from rounds
  where id = p_round_id;

  if not found then
    raise exception 'ラウンドの取得に失敗しました。';
  end if;

  insert into round_presets (owner_id, name, format, bow_type)
  values (auth.uid(), p_name, v_format, v_bow_type)
  returning id into v_preset_id;

  insert into round_preset_distances (
    preset_id, distance_number, distance, total_ends, arrows_per_end, target_face_id, is_marked
  )
  select v_preset_id, distance_number, distance, total_ends, arrows_per_end, target_face_id, is_marked
  from distances
  where round_id = p_round_id
  order by distance_number;

  return v_preset_id;
end;
$$;

grant execute on function save_round_as_preset(uuid, text) to authenticated;

commit;
