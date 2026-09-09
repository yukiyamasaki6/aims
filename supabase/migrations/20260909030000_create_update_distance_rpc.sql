begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- shotsの有無チェックと、その結果に応じて更新対象列を変えるdistancesの更新を
-- 1つの関数にまとめ、原子的に行う。別々のSupabase呼び出しに分けると、
-- チェックと更新の間に別クライアントが矢を記録する競合状態を防げない。
-- SECURITY INVOKERのため、内部のSELECT/UPDATEは呼び出しユーザーのRLS
-- （select_if_member/update_if_editor）をそのまま受ける。
create or replace function update_distance(
  p_distance_id uuid,
  p_distance bigint,
  p_total_ends bigint,
  p_arrows_per_end bigint,
  p_target_face_id uuid,
  p_is_marked boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_has_shots boolean;
begin
  select exists (
    select 1 from shots where distance_id = p_distance_id
  ) into v_has_shots;

  -- shotsが1件でも存在する距離は、総エンド数・エンドあたりの本数に加えて
  -- 的（target_face_id）も変更させない。的の種類が変わると点数の意味も
  -- 変わってしまい、既に記録済みのshotsと整合しなくなるため（UI側でも
  -- 読み取り専用にしているが、ここでも防御的に無視する）。distance・
  -- is_markedは点数構成に関係しないメタ情報なので、shots有無にかかわらず
  -- 常に変更できる。
  if v_has_shots then
    update distances
    set distance = p_distance, is_marked = p_is_marked
    where id = p_distance_id;
  else
    update distances
    set
      distance = p_distance,
      total_ends = p_total_ends,
      arrows_per_end = p_arrows_per_end,
      target_face_id = p_target_face_id,
      is_marked = p_is_marked
    where id = p_distance_id;
  end if;
end;
$$;

grant execute on function update_distance(uuid, bigint, bigint, bigint, uuid, boolean) to authenticated;

commit;
