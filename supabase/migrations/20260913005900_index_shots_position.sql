set lock_timeout = '1s';
set statement_timeout = '5s';

-- 既存の重複があれば失敗させ、射手やスコアを自動削除しない。
create unique index concurrently if not exists shots_distance_id_end_number_arrow_number_key
  on public.shots (distance_id, end_number, arrow_number);
