begin;

select plan(18);

-- formatとbow_typeの値の制約。
select throws_ok(
  $$update public.target_faces set format = 'invalid' where id = 'a1000000-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  '不正なformatはCHECK制約で拒否される'
);

select throws_ok(
  $$update public.target_faces set bow_type = array['invalid'] where id = 'a1000000-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  '許可されていない値を含むbow_typeはCHECK制約で拒否される'
);

select throws_ok(
  $$update public.target_faces set bow_type = array[]::text[] where id = 'a1000000-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  '空配列のbow_typeはCHECK制約で拒否される'
);

-- NOT NULL制約。
select throws_ok(
  $$insert into public.target_faces (size, format, placement)
    values (80, 'outdoor', 'single')$$,
  '23502',
  null,
  'target_faces.bow_typeを省略した作成はNOT NULL制約で拒否される'
);

select throws_ok(
  $$insert into public.target_faces (format, bow_type, placement)
    values ('outdoor', array['recurve'], 'single')$$,
  '23502',
  null,
  'target_faces.sizeを省略した作成はNOT NULL制約で拒否される'
);

select throws_ok(
  $$insert into public.target_faces (size, bow_type, placement)
    values (80, array['recurve'], 'single')$$,
  '23502',
  null,
  'target_faces.formatを省略した作成はNOT NULL制約で拒否される'
);

-- placementは既定値を持たず、省略できない。
select throws_ok(
  $$insert into public.target_faces (size, format, bow_type)
    values (80, 'outdoor', array['recurve'])$$,
  '23502',
  null,
  'target_faces.placementを省略した作成はNOT NULL制約で拒否される'
);

select throws_ok(
  $$update public.target_faces set placement = 'invalid' where id = 'a1000000-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  '単一・三角三つ目・縦三つ目以外のplacementはCHECK制約で拒否される'
);

-- 公式の的19件の配置、スポットの座標、属性とリングの構成。シードだけを数えるため、シード以外の的を作る前に確かめる。
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
  '公式の的19件は、IDごとの配置を持つ'
);

select bag_eq(
  $$select target_face_id, center_x, center_y from public.target_face_spots$$,
  $$values
    ('a1000000-0000-0000-0000-000000000001'::uuid, 0, 0),
    ('a1000000-0000-0000-0000-000000000002', 0, 0),
    ('a1000000-0000-0000-0000-000000000003', 0, 0),
    ('a1000000-0000-0000-0000-000000000004', 0, 0),
    ('a1000000-0000-0000-0000-000000000005', 0, 18.48),
    ('a1000000-0000-0000-0000-000000000005', -16, -9.24),
    ('a1000000-0000-0000-0000-000000000005', 16, -9.24),
    ('a1000000-0000-0000-0000-000000000006', 0, 32),
    ('a1000000-0000-0000-0000-000000000006', 0, 0),
    ('a1000000-0000-0000-0000-000000000006', 0, -32),
    ('a1000000-0000-0000-0000-000000000007', 0, 0),
    ('a1000000-0000-0000-0000-000000000008', 0, 12.70),
    ('a1000000-0000-0000-0000-000000000008', -11, -6.35),
    ('a1000000-0000-0000-0000-000000000008', 11, -6.35),
    ('a1000000-0000-0000-0000-000000000009', 0, 22),
    ('a1000000-0000-0000-0000-000000000009', 0, 0),
    ('a1000000-0000-0000-0000-000000000009', 0, -22),
    ('a1000000-0000-0000-0000-000000000010', 0, 0),
    ('a1000000-0000-0000-0000-000000000011', 0, 0),
    ('a1000000-0000-0000-0000-000000000012', 0, 0),
    ('a1000000-0000-0000-0000-000000000013', 0, 22),
    ('a1000000-0000-0000-0000-000000000013', 0, 0),
    ('a1000000-0000-0000-0000-000000000013', 0, -22),
    ('b1000000-0000-0000-0000-000000000001', 0, 0),
    ('b1000000-0000-0000-0000-000000000002', 0, 0),
    ('b1000000-0000-0000-0000-000000000003', 0, 18.48),
    ('b1000000-0000-0000-0000-000000000003', -16, -9.24),
    ('b1000000-0000-0000-0000-000000000003', 16, -9.24),
    ('b1000000-0000-0000-0000-000000000004', 0, 32),
    ('b1000000-0000-0000-0000-000000000004', 0, 0),
    ('b1000000-0000-0000-0000-000000000004', 0, -32),
    ('b1000000-0000-0000-0000-000000000005', 0, 12.70),
    ('b1000000-0000-0000-0000-000000000005', -11, -6.35),
    ('b1000000-0000-0000-0000-000000000005', 11, -6.35),
    ('b1000000-0000-0000-0000-000000000006', 0, 22),
    ('b1000000-0000-0000-0000-000000000006', 0, 0),
    ('b1000000-0000-0000-0000-000000000006', 0, -22)$$,
  '公式の的のスポット37件の座標は、配置の分類と一致する'
);

select results_eq(
  $$select f.id, f.format, f.size, f.bow_type, min(r.score_int), max(r.score_int), bool_or(r.score_str = 'X'),
      max(r.radius) filter (where r.score_str = '10' and r.score_int = 10)
    from public.target_faces f
    join public.target_face_spots s on s.target_face_id = f.id
    join public.target_face_rings r on r.spot_id = s.id
    group by f.id
    order by f.id$$,
  $$values
    ('a1000000-0000-0000-0000-000000000001'::uuid, 'outdoor', 122::bigint, array['recurve', 'compound', 'barebow'], 1::bigint, 10::bigint, true, 6.1::numeric),
    ('a1000000-0000-0000-0000-000000000002', 'outdoor', 80, array['recurve', 'compound', 'barebow'], 1, 10, true, 4),
    ('a1000000-0000-0000-0000-000000000003', 'outdoor', 80, array['recurve', 'compound', 'barebow'], 5, 10, true, 4),
    ('a1000000-0000-0000-0000-000000000004', 'indoor', 60, array['recurve', 'barebow'], 1, 10, false, 3),
    ('a1000000-0000-0000-0000-000000000005', 'indoor', 60, array['recurve', 'barebow'], 6, 10, false, 3),
    ('a1000000-0000-0000-0000-000000000006', 'indoor', 60, array['recurve', 'barebow'], 6, 10, false, 3),
    ('a1000000-0000-0000-0000-000000000007', 'indoor', 40, array['recurve', 'barebow'], 1, 10, false, 2),
    ('a1000000-0000-0000-0000-000000000008', 'indoor', 40, array['recurve', 'barebow'], 6, 10, false, 2),
    ('a1000000-0000-0000-0000-000000000009', 'indoor', 40, array['recurve', 'barebow'], 6, 10, false, 2),
    ('a1000000-0000-0000-0000-000000000010', 'field', 80, array['recurve', 'compound', 'barebow'], 1, 6, false, null),
    ('a1000000-0000-0000-0000-000000000011', 'field', 60, array['recurve', 'compound', 'barebow'], 1, 6, false, null),
    ('a1000000-0000-0000-0000-000000000012', 'field', 40, array['recurve', 'compound', 'barebow'], 1, 6, false, null),
    ('a1000000-0000-0000-0000-000000000013', 'field', 20, array['recurve', 'compound', 'barebow'], 1, 6, false, null),
    ('b1000000-0000-0000-0000-000000000001', 'indoor', 60, array['compound'], 1, 10, false, 1.5),
    ('b1000000-0000-0000-0000-000000000002', 'indoor', 40, array['compound'], 1, 10, false, 1),
    ('b1000000-0000-0000-0000-000000000003', 'indoor', 60, array['compound'], 6, 10, false, 1.5),
    ('b1000000-0000-0000-0000-000000000004', 'indoor', 60, array['compound'], 6, 10, false, 1.5),
    ('b1000000-0000-0000-0000-000000000005', 'indoor', 40, array['compound'], 6, 10, false, 1),
    ('b1000000-0000-0000-0000-000000000006', 'indoor', 40, array['compound'], 6, 10, false, 1)$$,
  '公式の的19件の種別、サイズ、対応弓種、点数帯、Xの有無、10点の半径が一致する'
);

select is_empty(
  $$select target_face_id
    from (
      select s.target_face_id,
        array_agg(row(r.radius, r.color, r.line_color, r.z_index, r.score_str, r.score_int)::text order by r.z_index, r.score_str) as rings
      from public.target_face_spots s
      join public.target_face_rings r on r.spot_id = s.id
      group by s.target_face_id, s.id
    ) spot_rings
    group by target_face_id
    having count(distinct rings) > 1$$,
  '同じ的の全てのスポットは、同じリングの構成を持つ'
);

-- 参照中の的は削除できない。
select throws_ok(
  $$delete from public.target_faces where id = 'a1000000-0000-0000-0000-000000000001'$$,
  '23503',
  null,
  '参照中のtarget_faceは外部キー制約で削除できない'
);

-- Fixture: シード以外の的。
-- 的はシードのみでアプリから書き込まないため、authenticatedにはSELECTだけを許可する。
insert into auth.users (id) values ('99999999-9999-9999-9999-999999999999');

insert into public.target_faces (id, placement, size, format, bow_type)
values ('22222222-2222-2222-2222-222222222222', 'single', 80, 'outdoor', array['recurve', 'compound', 'barebow']);

insert into public.target_face_spots (id, target_face_id, center_x, center_y)
values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 0, 0);

insert into public.target_face_rings (spot_id, radius, color, line_color, z_index, score_str, score_int)
values ('33333333-3333-3333-3333-333333333333', 6.1, '#FFE552', null, 1, '10', 10);

set local role authenticated;

-- 認証済みユーザーは、全ての的・スポット・リングを閲覧できる。
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);
select results_eq(
  $$select count(*) from public.target_faces where id = '22222222-2222-2222-2222-222222222222'$$,
  $$values (1::bigint)$$,
  '認証済みユーザーは全ての的を閲覧できる'
);

select results_eq(
  $$select count(*) from public.target_face_spots where target_face_id = '22222222-2222-2222-2222-222222222222'$$,
  $$values (1::bigint)$$,
  '認証済みユーザーは全ての的のスポットを閲覧できる'
);

-- このアプリは認証済みユーザーだけが利用するため、未認証では参照できない。
set local role anon;
select throws_ok(
  $$select count(*) from public.target_faces$$,
  '42501',
  null,
  '未認証（anon）は的を閲覧できない'
);

select throws_ok(
  $$select id from public.target_faces where id = '22222222-2222-2222-2222-222222222222'$$,
  '42501',
  null,
  '未認証（anon）は的を個別に指定しても閲覧できない'
);

select throws_ok(
  $$select s.id from public.target_face_spots s
    join public.target_faces tf on tf.id = s.target_face_id
    where tf.id = '22222222-2222-2222-2222-222222222222'$$,
  '42501',
  null,
  '未認証（anon）は的のスポットも閲覧できない'
);

select * from finish();

rollback;
