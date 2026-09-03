begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- ============================================================
-- target_faces.bow_type: この的が対応する弓種（複数可）。
--
-- アウトドア・フィールドは弓種によらず得点帯が共通のため全弓種が対応する
-- （JAAルールブック的仕様章に、80cm-6リング的もリカーブの中学生・小学生
-- ラウンドで使用できると明記されており、コンパウンド専用ではない）。
-- インドアのみ弓種で得点帯構成が異なり、リカーブ・ベアボウ共通の的と
-- コンパウンド専用の的（issue #163で追加、英語名の的）とで対応する弓種が
-- 分かれる。roundsの弓種で的選択を絞り込むため、formatと同様に名前文字列
-- からの場当たり的な判定ではなく列として直接持たせる。
-- ============================================================

-- array_length(bow_type, 1)は空配列に対してNULLを返し、CHECK制約はNULLを
-- 満たすものとして扱ってしまう（拒否されない）ため、空配列でも0を返す
-- cardinalityを使う。
alter table target_faces add column if not exists bow_type text[]
  check (bow_type <@ array['recurve', 'compound', 'barebow']::text[])
  check (cardinality(bow_type) > 0);

update target_faces set bow_type = array['recurve', 'compound', 'barebow']
  where id in (
    'a1000000-0000-0000-0000-000000000001', -- 10点的（アウトドア・122cm）
    'a1000000-0000-0000-0000-000000000002', -- 10点的（アウトドア・80cm）
    'a1000000-0000-0000-0000-000000000003', -- 6点的（アウトドア・80cm）
    'a1000000-0000-0000-0000-000000000010', -- フィールド的（80cm）
    'a1000000-0000-0000-0000-000000000011', -- フィールド的（60cm）
    'a1000000-0000-0000-0000-000000000012', -- フィールド的（40cm）
    'a1000000-0000-0000-0000-000000000013'  -- フィールド的（20cm・3つ目バーティカル）
  );

update target_faces set bow_type = array['recurve', 'barebow']
  where id in (
    'a1000000-0000-0000-0000-000000000004', -- 10点的（インドア・60cm）
    'a1000000-0000-0000-0000-000000000005', -- 6点的（インドア・60cm・3つ目トライアングル）
    'a1000000-0000-0000-0000-000000000006', -- 6点的（インドア・60cm・3つ目バーティカル）
    'a1000000-0000-0000-0000-000000000007', -- 10点的（インドア・40cm）
    'a1000000-0000-0000-0000-000000000008', -- 6点的（インドア・40cm・3つ目トライアングル）
    'a1000000-0000-0000-0000-000000000009'  -- 6点的（インドア・40cm・3つ目バーティカル）
  );

update target_faces set bow_type = array['compound']
  where id in (
    'b1000000-0000-0000-0000-000000000001', -- Indoor 60cm Compound
    'b1000000-0000-0000-0000-000000000002', -- Indoor 40cm Compound
    'b1000000-0000-0000-0000-000000000003', -- Indoor 60cm Triangular 3-spot Compound
    'b1000000-0000-0000-0000-000000000004', -- Indoor 60cm Vertical 3-spot Compound
    'b1000000-0000-0000-0000-000000000005', -- Indoor 40cm Triangular 3-spot Compound
    'b1000000-0000-0000-0000-000000000006'  -- Indoor 40cm Vertical 3-spot Compound
  );

alter table target_faces
  add constraint target_faces_bow_type_not_null check (bow_type is not null) not valid;

commit;
