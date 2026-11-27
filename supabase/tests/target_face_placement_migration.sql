-- 名称(name)を持つ公式の的を、配置(placement)へ移す移行を確認する。
--   - 配置はIDごとに割り当てられ、名称の列は残らない
--   - 的のID・サイズ・種別・対応弓種・作成日時、スポットとリング、距離とプリセット距離の参照は変わらない(的のupdated_atは既存のトリガーで進むため比べない)
-- 実行の方式: pgTAPのトランザクションの中で、target_facesを移行前の形へDDLで戻し、距離から的を参照するデータを入れ、
-- 適用済みの移行のSQL（supabase_migrations.schema_migrationsのstatements）を実行し、結果を確かめて巻き戻す。
-- 移行のファイルは、テストの実行環境から読めない（tests/だけが読める）ため、CLIが適用時に記録した同じSQLを使う。

begin;

select plan(9);

-- 適用済みの移行のSQLを、記録された順に実行する。
create function pg_temp.run_migration() returns void
language plpgsql
as $$
declare
  v_statements text[];
  v_statement text;
begin
  select statements into strict v_statements
  from supabase_migrations.schema_migrations where version = '20261127000001';
  foreach v_statement in array v_statements loop
    execute v_statement;
  end loop;
end;
$$;

-- 移行前の形へ戻す。公式の的19件は、移行前の名称を持つ。
alter table public.target_faces drop column placement;
alter table public.target_faces add column name text;

update public.target_faces f set name = legacy.name
from (
  values
    ('a1000000-0000-0000-0000-000000000001'::uuid, '10点的（アウトドア・122cm）'),
    ('a1000000-0000-0000-0000-000000000002', '10点的（アウトドア・80cm）'),
    ('a1000000-0000-0000-0000-000000000003', '6点的（アウトドア・80cm）'),
    ('a1000000-0000-0000-0000-000000000004', '10点的（インドア・60cm）'),
    ('a1000000-0000-0000-0000-000000000005', '6点的（インドア・60cm・3つ目トライアングル）'),
    ('a1000000-0000-0000-0000-000000000006', '6点的（インドア・60cm・3つ目バーティカル）'),
    ('a1000000-0000-0000-0000-000000000007', '10点的（インドア・40cm）'),
    ('a1000000-0000-0000-0000-000000000008', '6点的（インドア・40cm・3つ目トライアングル）'),
    ('a1000000-0000-0000-0000-000000000009', '6点的（インドア・40cm・3つ目バーティカル）'),
    ('a1000000-0000-0000-0000-000000000010', 'フィールド的（80cm）'),
    ('a1000000-0000-0000-0000-000000000011', 'フィールド的（60cm）'),
    ('a1000000-0000-0000-0000-000000000012', 'フィールド的（40cm）'),
    ('a1000000-0000-0000-0000-000000000013', 'フィールド的（20cm・3つ目バーティカル）'),
    ('b1000000-0000-0000-0000-000000000001', 'Indoor 60cm Compound'),
    ('b1000000-0000-0000-0000-000000000002', 'Indoor 40cm Compound'),
    ('b1000000-0000-0000-0000-000000000003', 'Indoor 60cm Triangular 3-spot Compound'),
    ('b1000000-0000-0000-0000-000000000004', 'Indoor 60cm Vertical 3-spot Compound'),
    ('b1000000-0000-0000-0000-000000000005', 'Indoor 40cm Triangular 3-spot Compound'),
    ('b1000000-0000-0000-0000-000000000006', 'Indoor 40cm Vertical 3-spot Compound')
) as legacy (id, name)
where f.id = legacy.id;

alter table public.target_faces alter column name set not null;

-- Fixture: 屋外(各距離6エンド×6射)とインドア(各距離10エンド×3射)のラウンドの距離から、単一・三角三つ目・縦三つ目と、両方の弓種の群の的を参照する。
insert into public.rounds (id, name, round_date, format, bow_type) values
  ('f3000000-0000-0000-0000-000000000001', 'Migration Outdoor', '2026-01-01', 'outdoor', 'recurve'),
  ('f3000000-0000-0000-0000-000000000002', 'Migration Indoor Recurve', '2026-01-02', 'indoor', 'recurve'),
  ('f3000000-0000-0000-0000-000000000003', 'Migration Indoor Compound', '2026-01-03', 'indoor', 'compound');

insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked) values
  ('f3000000-0000-0000-0000-000000000011', 'f3000000-0000-0000-0000-000000000001', 'a', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001', true),
  ('f3000000-0000-0000-0000-000000000012', 'f3000000-0000-0000-0000-000000000001', 'b', 50, 6, 6, 'a1000000-0000-0000-0000-000000000003', true),
  ('f3000000-0000-0000-0000-000000000021', 'f3000000-0000-0000-0000-000000000002', 'a', 18, 10, 3, 'a1000000-0000-0000-0000-000000000007', true),
  ('f3000000-0000-0000-0000-000000000022', 'f3000000-0000-0000-0000-000000000002', 'b', 18, 10, 3, 'a1000000-0000-0000-0000-000000000008', true),
  ('f3000000-0000-0000-0000-000000000023', 'f3000000-0000-0000-0000-000000000002', 'c', 18, 10, 3, 'a1000000-0000-0000-0000-000000000009', true),
  ('f3000000-0000-0000-0000-000000000031', 'f3000000-0000-0000-0000-000000000003', 'a', 18, 10, 3, 'b1000000-0000-0000-0000-000000000002', true),
  ('f3000000-0000-0000-0000-000000000032', 'f3000000-0000-0000-0000-000000000003', 'b', 18, 10, 3, 'b1000000-0000-0000-0000-000000000003', true),
  ('f3000000-0000-0000-0000-000000000033', 'f3000000-0000-0000-0000-000000000003', 'c', 18, 10, 3, 'b1000000-0000-0000-0000-000000000004', true);

-- 移行の前の行。プリセット距離は公式プリセットの行を含む。
create temp table mg_faces as select id, size, format, bow_type, created_at from public.target_faces;
create temp table mg_spots as select * from public.target_face_spots;
create temp table mg_rings as select * from public.target_face_rings;
create temp table mg_distances as select * from public.distances;
create temp table mg_preset_distances as select * from public.preset_distances;

select lives_ok(
  'select pg_temp.run_migration()',
  '移行前の形のデータに対して、移行は失敗せず完了する'
);

select results_eq(
  $$select id, placement from public.target_faces order by id$$,
  $$values
    ('a1000000-0000-0000-0000-000000000001'::uuid, 'single'),
    ('a1000000-0000-0000-0000-000000000002', 'single'),
    ('a1000000-0000-0000-0000-000000000003', 'single'),
    ('a1000000-0000-0000-0000-000000000004', 'single'),
    ('a1000000-0000-0000-0000-000000000005', 'triangle'),
    ('a1000000-0000-0000-0000-000000000006', 'vertical'),
    ('a1000000-0000-0000-0000-000000000007', 'single'),
    ('a1000000-0000-0000-0000-000000000008', 'triangle'),
    ('a1000000-0000-0000-0000-000000000009', 'vertical'),
    ('a1000000-0000-0000-0000-000000000010', 'single'),
    ('a1000000-0000-0000-0000-000000000011', 'single'),
    ('a1000000-0000-0000-0000-000000000012', 'single'),
    ('a1000000-0000-0000-0000-000000000013', 'vertical'),
    ('b1000000-0000-0000-0000-000000000001', 'single'),
    ('b1000000-0000-0000-0000-000000000002', 'single'),
    ('b1000000-0000-0000-0000-000000000003', 'triangle'),
    ('b1000000-0000-0000-0000-000000000004', 'vertical'),
    ('b1000000-0000-0000-0000-000000000005', 'triangle'),
    ('b1000000-0000-0000-0000-000000000006', 'vertical')$$,
  '公式の的19件に、IDごとの配置が割り当てられる'
);

select results_eq(
  $$select id, size, format, bow_type, created_at from public.target_faces order by id$$,
  $$select id, size, format, bow_type, created_at from mg_faces order by id$$,
  '的のID・サイズ・種別・対応弓種・作成日時は変わらない'
);

select results_eq(
  $$select * from public.target_face_spots order by id$$,
  $$select * from mg_spots order by id$$,
  'スポットは全ての列が変わらない'
);

select results_eq(
  $$select * from public.target_face_rings order by id$$,
  $$select * from mg_rings order by id$$,
  'リングは全ての列が変わらない'
);

select results_eq(
  $$select * from public.distances order by id$$,
  $$select * from mg_distances order by id$$,
  '距離は、的の参照を含む全ての列が変わらない'
);

select results_eq(
  $$select * from public.preset_distances order by id$$,
  $$select * from mg_preset_distances order by id$$,
  'プリセット距離は、的の参照を含む全ての列が変わらない'
);

select hasnt_column('public', 'target_faces', 'name', '的の名称の列は残らない');

select col_not_null('public', 'target_faces', 'placement', 'target_faces.placementはNOT NULLである');

select * from finish();

rollback;
