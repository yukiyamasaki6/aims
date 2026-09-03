begin;

select plan(52);

select has_table('public', 'target_faces', 'target_faces テーブルが存在する');
select has_table('public', 'target_face_spots', 'target_face_spots テーブルが存在する');
select has_table('public', 'target_face_rings', 'target_face_rings テーブルが存在する');
select has_column('public', 'target_faces', 'size', 'target_faces.size カラムが存在する');
select has_column('public', 'target_faces', 'format', 'target_faces.format カラムが存在する');
select has_column('public', 'target_faces', 'bow_type', 'target_faces.bow_type カラムが存在する');

-- formatは的の選択UIの並び順（種類→サイズ）を、名前文字列の解析ではなく
-- roundsやdistancesと同じ意味を持つ列で扱うために持たせる。
select results_eq(
  $$select format from public.target_faces where name = '10点的（アウトドア・122cm）'$$,
  $$values ('outdoor'::text)$$,
  '10点的（アウトドア・122cm）のformatはoutdoor'
);

select results_eq(
  $$select format from public.target_faces where name = '10点的（インドア・40cm）'$$,
  $$values ('indoor'::text)$$,
  '10点的（インドア・40cm）のformatはindoor'
);

select results_eq(
  $$select format from public.target_faces where name = 'フィールド的（80cm）'$$,
  $$values ('field'::text)$$,
  'フィールド的（80cm）のformatはfield'
);

select throws_ok(
  $$update public.target_faces set format = 'invalid' where name = '10点的（アウトドア・122cm）'$$,
  '23514',
  null,
  '不正なformatはCHECK制約で拒否される'
);

-- bow_typeはこの的が対応する弓種（複数可）。アウトドア・フィールドは弓種に
-- よらず得点帯が共通のため全弓種、インドアはリカーブ・ベアボウ共通の的と
-- コンパウンド専用の的（issue #163で追加）とで分かれる
-- （JAAルールブック的仕様章で80cm-6リングもリカーブの中学生・小学生
-- ラウンドで使用可能と明記されているため、アウトドアはコンパウンド限定
-- ではなく全弓種とする）。
select results_eq(
  $$select bow_type from public.target_faces where name = '10点的（アウトドア・122cm）'$$,
  $$values (array['recurve', 'compound', 'barebow']::text[])$$,
  '10点的（アウトドア・122cm）のbow_typeは全弓種'
);

select results_eq(
  $$select bow_type from public.target_faces where name = '6点的（アウトドア・80cm）'$$,
  $$values (array['recurve', 'compound', 'barebow']::text[])$$,
  '6点的（アウトドア・80cm）のbow_typeは全弓種（コンパウンド限定ではない）'
);

select results_eq(
  $$select bow_type from public.target_faces where name = '10点的（インドア・60cm）'$$,
  $$values (array['recurve', 'barebow']::text[])$$,
  '10点的（インドア・60cm）のbow_typeはリカーブ・ベアボウ'
);

select results_eq(
  $$select bow_type from public.target_faces where name = 'Indoor 60cm Compound'$$,
  $$values (array['compound']::text[])$$,
  'Indoor 60cm Compoundのbow_typeはコンパウンドのみ'
);

select results_eq(
  $$select bow_type from public.target_faces where name = 'フィールド的（80cm）'$$,
  $$values (array['recurve', 'compound', 'barebow']::text[])$$,
  'フィールド的（80cm）のbow_typeは全弓種'
);

select throws_ok(
  $$update public.target_faces set bow_type = array['invalid'] where name = '10点的（アウトドア・122cm）'$$,
  '23514',
  null,
  '許可されていない値を含むbow_typeはCHECK制約で拒否される'
);

select throws_ok(
  $$update public.target_faces set bow_type = array[]::text[] where name = '10点的（アウトドア・122cm）'$$,
  '23514',
  null,
  '空配列のbow_typeはCHECK制約で拒否される'
);

select throws_ok(
  $$insert into public.target_faces (owner_id, name, size, format)
    values ('11111111-1111-1111-1111-111111111111', 'Missing Bow Type', 80, 'outdoor')$$,
  '23502',
  null,
  'target_faces.bow_typeを省略した作成はNOT NULL制約で拒否される'
);

-- sizeは実際の的紙サイズであり、6点的（得点帯が中心の一部にしか印刷されない）
-- のようにリング半径から逆算すると小さく出てしまうケースがあるため、リング
-- ジオメトリとは独立した値として持つ。
select results_eq(
  $$select size from public.target_faces where name = '10点的（アウトドア・122cm）'$$,
  $$values (122::bigint)$$,
  '10点的（アウトドア・122cm）のsizeは122'
);

select results_eq(
  $$select size from public.target_faces where name = '6点的（アウトドア・80cm）'$$,
  $$values (80::bigint)$$,
  '6点的（アウトドア・80cm）のsizeは、最外リング径(48cm)ではなく的紙サイズの80'
);

select results_eq(
  $$select size from public.target_faces where name = '6点的（インドア・40cm・3つ目トライアングル）'$$,
  $$values (40::bigint)$$,
  '6点的（インドア・40cm・3つ目トライアングル）のsizeは40'
);

-- Seed data: グローバル的（owner_id is null）が投入されている。
-- 標準13件 + インドア・コンパウンド用に追加した6件 = 19件。
select results_eq(
  $$select count(*) from public.target_faces where owner_id is null$$,
  $$values (19::bigint)$$,
  'グローバル的が19件シードされている（標準13件+インドア・コンパウンド用6件）'
);

select results_eq(
  $$select count(*) from public.target_face_spots s
    join public.target_faces tf on tf.id = s.target_face_id
    where tf.name = '6点的（インドア・40cm・3つ目トライアングル）'$$,
  $$values (3::bigint)$$,
  '3つ目の的は3つのスポットを持つ'
);

select results_eq(
  $$select count(*) from public.target_face_rings$$,
  $$values (225::bigint)$$,
  'シードされた的の点数帯は合計225件'
);

select results_eq(
  $$select count(*) from public.target_face_rings where line_color is null$$,
  $$values (18::bigint)$$,
  '境界線なしのリングが存在する'
);

-- インドアの弓種差分（issue #163）:
-- インドアにはXという区分自体が存在しない（弓種を問わず最高得点帯は常に"10"）。
--   - リカーブ・ベアボウ共通の的は旧Xリングを削除し、旧10リング（半径はそのまま）が中心をカバーする。
--   - コンパウンド専用の的（英語名）は旧10リングを削除し、旧Xリングの半径がscore_str="10"として中心をカバーする。
-- リング半径・色はどちらも標準（9,10,X）のシードと同一で、score_str/score_intのみ異なる。
-- コンパウンド専用の的だけが英語名（例: 'Indoor 60cm Compound'）で追加されている。

select is_empty(
  $$select r.id from public.target_face_rings r
    join public.target_face_spots s on s.id = r.spot_id
    join public.target_faces tf on tf.id = s.target_face_id
    where tf.format = 'indoor' and r.score_str = 'X'$$,
  'インドアの的（リカーブ・ベアボウ・コンパウンドいずれも）にXリングは存在しない'
);

select results_eq(
  $$select score_str, score_int from public.target_face_rings r
    join public.target_face_spots s on s.id = r.spot_id
    join public.target_faces tf on tf.id = s.target_face_id
    where tf.name = '10点的（インドア・60cm）'
    order by r.radius asc limit 1$$,
  $$values ('10'::text, 10::bigint)$$,
  '10点的（インドア・60cm）は旧Xリング（半径1.5cm）が削除され、最小半径(3cm)の10リングが中心をカバーする'
);

select results_eq(
  $$select score_str, score_int from public.target_face_rings r
    join public.target_face_spots s on s.id = r.spot_id
    join public.target_faces tf on tf.id = s.target_face_id
    where tf.name = '10点的（インドア・40cm）'
    order by r.radius asc limit 1$$,
  $$values ('10'::text, 10::bigint)$$,
  '10点的（インドア・40cm）は旧Xリング（半径1cm）が削除され、最小半径(2cm)の10リングが中心をカバーする'
);

select results_eq(
  $$select score_str, score_int from public.target_face_rings r
    join public.target_face_spots s on s.id = r.spot_id
    join public.target_faces tf on tf.id = s.target_face_id
    where tf.name = 'Indoor 60cm Compound'
    order by r.radius asc limit 1$$,
  $$values ('10'::text, 10::bigint)$$,
  'Indoor 60cm Compoundは旧10リングが削除され、旧Xリング（半径1.5cm）がscore_str=10として中心をカバーする'
);

select results_eq(
  $$select score_str, score_int from public.target_face_rings r
    join public.target_face_spots s on s.id = r.spot_id
    join public.target_faces tf on tf.id = s.target_face_id
    where tf.name = 'Indoor 40cm Compound'
    order by r.radius asc limit 1$$,
  $$values ('10'::text, 10::bigint)$$,
  'Indoor 40cm Compoundは旧10リングが削除され、旧Xリング（半径1cm）がscore_str=10として中心をカバーする'
);

-- インドアの3つ目（6点的）は最外周が青（6点）で、他の的の最外周（白1点等）と
-- 同様に黒い境界線を持つ（線なしでシードされていたのを修正、リカーブ/ベアボウ・
-- コンパウンドいずれも対象）。
select is_empty(
  $$select r.id from public.target_face_rings r
    join public.target_face_spots s on s.id = r.spot_id
    join public.target_faces tf on tf.id = s.target_face_id
    where tf.format = 'indoor' and r.score_str = '6' and r.line_color is null$$,
  'インドアの3つ目（6点的）の最外周（6点）は境界線なしではない'
);

-- 6点的（アウトドア・80cm）も同様に最外周（5点）が境界線なしでシードされて
-- いたのを黒に修正する。
select results_eq(
  $$select line_color from public.target_face_rings r
    join public.target_face_spots s on s.id = r.spot_id
    join public.target_faces tf on tf.id = s.target_face_id
    where tf.name = '6点的（アウトドア・80cm）' and r.score_str = '5'$$,
  $$values ('#231F20'::text)$$,
  '6点的（アウトドア・80cm）の最外周（5点）は境界線なしではない'
);

select results_eq(
  $$select format, size from public.target_faces where name = 'Indoor 60cm Compound'$$,
  $$values ('indoor'::text, 60::bigint)$$,
  'Indoor 60cm Compoundのformat/sizeが正しい'
);

select results_eq(
  $$select format, size from public.target_faces where name = 'Indoor 40cm Compound'$$,
  $$values ('indoor'::text, 40::bigint)$$,
  'Indoor 40cm Compoundのformat/sizeが正しい'
);

select results_eq(
  $$select count(*) from public.target_face_spots s
    join public.target_faces tf on tf.id = s.target_face_id
    where tf.name = 'Indoor 40cm Triangular 3-spot Compound'$$,
  $$values (3::bigint)$$,
  'Indoor 40cm Triangular 3-spot Compoundも3スポットを持つ'
);

select results_eq(
  $$select count(*) from public.target_face_spots s
    join public.target_faces tf on tf.id = s.target_face_id
    where tf.name = 'Indoor 60cm Vertical 3-spot Compound'$$,
  $$values (3::bigint)$$,
  'Indoor 60cm Vertical 3-spot Compoundも3スポットを持つ'
);

select throws_ok(
  $$delete from public.target_faces where id = 'a1000000-0000-0000-0000-000000000001'$$,
  '23503',
  null,
  '参照中のtarget_faceは外部キー制約で削除できない'
);

-- Fixture: two users. RLS挙動を確認する。
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111');
insert into auth.users (id) values ('99999999-9999-9999-9999-999999999999');

set local role authenticated;

-- User A: 自分のowner_idで個人的な的を作成できる。
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select lives_ok(
  $$insert into public.target_faces (id, owner_id, name, size, format, bow_type)
    values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'My Target', 80, 'outdoor', array['recurve', 'compound', 'barebow'])$$,
  'ユーザーは自分のowner_idで的を作成できる'
);

select throws_ok(
  $$insert into public.target_faces (owner_id, name, format)
    values ('11111111-1111-1111-1111-111111111111', 'Missing Size', 'outdoor')$$,
  '23502',
  null,
  'target_faces.sizeを省略した作成はNOT NULL制約で拒否される'
);

select throws_ok(
  $$insert into public.target_faces (owner_id, name, size)
    values ('11111111-1111-1111-1111-111111111111', 'Missing Format', 80)$$,
  '23502',
  null,
  'target_faces.formatを省略した作成はNOT NULL制約で拒否される'
);

select throws_like(
  $$insert into public.target_faces (owner_id, name, size, format, bow_type)
    values (null, 'Global attempt', 80, 'outdoor', array['recurve', 'compound', 'barebow'])$$,
  '%row-level security%',
  'クライアントはowner_idをnull（グローバル）にして的を作成できない'
);

select throws_like(
  $$insert into public.target_faces (owner_id, name, size, format, bow_type)
    values ('99999999-9999-9999-9999-999999999999', 'Other owner attempt', 80, 'outdoor', array['recurve', 'compound', 'barebow'])$$,
  '%row-level security%',
  'ユーザーは他人のowner_idで的を作成できない'
);

-- User B: 他人の個人的な的も含め、グローバル・個人問わず全て閲覧できる。
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);
select results_eq(
  $$select count(*) from public.target_faces where id = '22222222-2222-2222-2222-222222222222'$$,
  $$values (1::bigint)$$,
  '他ユーザーの個人的な的も閲覧できる'
);

select throws_like(
  $$insert into public.target_face_spots (target_face_id, center_x, center_y)
    values ('22222222-2222-2222-2222-222222222222', 0, 0)$$,
  '%row-level security%',
  '他ユーザーは自分が所有しない的にスポットを追加できない'
);

select is_empty(
  $$update public.target_faces set name = 'Hijacked'
    where id = '22222222-2222-2222-2222-222222222222'
    returning id$$,
  '他ユーザーは自分が所有しない的を更新できない（0件更新）'
);

select is_empty(
  $$delete from public.target_faces
    where id = '22222222-2222-2222-2222-222222222222'
    returning id$$,
  '他ユーザーは自分が所有しない的を削除できない（0件削除）'
);

-- User A: 自分の的にスポット・点数帯を追加でき、削除もできる（子テーブルは親のowner_idに従う）。
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select lives_ok(
  $$insert into public.target_face_spots (id, target_face_id, center_x, center_y)
    values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 0, 0)$$,
  '所有者は自分の的にスポットを追加できる'
);

select lives_ok(
  $$insert into public.target_face_rings (spot_id, radius, color, line_color, z_index, score_str, score_int)
    values ('33333333-3333-3333-3333-333333333333', 6.1, '#FFE552', null, 1, '10', 10)$$,
  '所有者は自分の的のスポットに点数帯を追加できる（境界線なしも許容される）'
);

select throws_ok(
  $$insert into public.target_face_rings (spot_id, radius, color, line_color, z_index, score_str, score_int)
    values ('33333333-3333-3333-3333-333333333333', 5.0, '#FFFFFF', null, 1, '9', 9)$$,
  '23505',
  null,
  '同一(spot_id, z_index)の重複挿入は一意制約で拒否される'
);

select lives_ok(
  $$delete from public.target_faces where id = '22222222-2222-2222-2222-222222222222'$$,
  '所有者は自分の的を削除できる'
);

select results_eq(
  $$select count(*) from public.target_face_spots where target_face_id = '22222222-2222-2222-2222-222222222222'$$,
  $$values (0::bigint)$$,
  '的の削除でスポットがカスケード削除される'
);

select results_eq(
  $$select count(*) from public.target_face_rings where spot_id = '33333333-3333-3333-3333-333333333333'$$,
  $$values (0::bigint)$$,
  '的の削除で点数帯もカスケード削除される（スポット経由の多段カスケード）'
);

select * from finish();

rollback;
