begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- ============================================================
-- target_faces.format: 的の種別（アウトドア/インドア/フィールド）。
-- rounds.format / distances由来のdistance-config UIと同じ語彙を使う。
--
-- 的選択UIの並び順（種類→サイズ）を、名前文字列の解析（先頭が「10点的」
-- か「6点的」か、括弧内に「アウトドア」を含むか等）で場当たり的に判定
-- するのではなく、sizeと同様に意味を持つ列として直接持たせる。
-- ============================================================

alter table target_faces add column if not exists format text
  check (format in ('outdoor', 'indoor', 'field'));

update target_faces set format = 'outdoor' where id = 'a1000000-0000-0000-0000-000000000001';
update target_faces set format = 'outdoor' where id = 'a1000000-0000-0000-0000-000000000002';
update target_faces set format = 'outdoor' where id = 'a1000000-0000-0000-0000-000000000003';
update target_faces set format = 'indoor'  where id = 'a1000000-0000-0000-0000-000000000004';
update target_faces set format = 'indoor'  where id = 'a1000000-0000-0000-0000-000000000005';
update target_faces set format = 'indoor'  where id = 'a1000000-0000-0000-0000-000000000006';
update target_faces set format = 'indoor'  where id = 'a1000000-0000-0000-0000-000000000007';
update target_faces set format = 'indoor'  where id = 'a1000000-0000-0000-0000-000000000008';
update target_faces set format = 'indoor'  where id = 'a1000000-0000-0000-0000-000000000009';
update target_faces set format = 'field'   where id = 'a1000000-0000-0000-0000-000000000010';
update target_faces set format = 'field'   where id = 'a1000000-0000-0000-0000-000000000011';
update target_faces set format = 'field'   where id = 'a1000000-0000-0000-0000-000000000012';
update target_faces set format = 'field'   where id = 'a1000000-0000-0000-0000-000000000013';

alter table target_faces
  add constraint target_faces_format_not_null check (format is not null) not valid;

commit;
