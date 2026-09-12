begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- ============================================================
-- rounds.name / round_presets.name:
-- 表示上の可読性（一覧・要約行のいずれも折り返し/省略に対応していない）を
-- 保つため、50文字までに制限する。クライアント側（入力欄のmaxLength）
-- だけでなくDB側でも保証する。
-- ============================================================

alter table rounds
  add constraint rounds_name_length
    check (char_length(name) <= 50) not valid;

alter table round_presets
  add constraint round_presets_name_length
    check (char_length(name) <= 50) not valid;

commit;
