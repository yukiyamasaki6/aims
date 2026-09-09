begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- Unmarkedな距離の有無チェックとroundsの更新を1つの関数にまとめ、原子的に行う。
-- 別々のSupabase呼び出しに分けると、チェックと更新の間に別クライアントの
-- 書き込みが割り込む競合状態を防げない。SECURITY INVOKERのため、内部の
-- SELECT/UPDATEは呼び出しユーザーのRLS（select_if_member/update_if_editor）を
-- そのまま受ける。
create or replace function update_round_config(
  p_round_id uuid,
  p_name text,
  p_round_date date,
  p_format text,
  p_bow_type text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_format <> 'field' and exists (
    select 1 from distances
    where round_id = p_round_id and is_marked = false
  ) then
    raise exception 'Unmarkedの距離が残っているため、フィールド以外の種別には変更できません。先に各距離をMarkedに変更してください。';
  end if;

  update rounds
  set name = p_name, round_date = p_round_date, format = p_format, bow_type = p_bow_type
  where id = p_round_id;
end;
$$;

grant execute on function update_round_config(uuid, text, date, text, text) to authenticated;

commit;
