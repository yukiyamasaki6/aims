begin;

select plan(12);

-- formatとbow_typeの値の制約。
select throws_ok(
  $$update public.target_faces set format = 'invalid' where name = '10点的（アウトドア・122cm）'$$,
  '23514',
  null,
  '不正なformatはCHECK制約で拒否される'
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

-- NOT NULL制約。
select throws_ok(
  $$insert into public.target_faces (name, size, format)
    values ('Missing Bow Type', 80, 'outdoor')$$,
  '23502',
  null,
  'target_faces.bow_typeを省略した作成はNOT NULL制約で拒否される'
);

select throws_ok(
  $$insert into public.target_faces (name, format)
    values ('Missing Size', 'outdoor')$$,
  '23502',
  null,
  'target_faces.sizeを省略した作成はNOT NULL制約で拒否される'
);

select throws_ok(
  $$insert into public.target_faces (name, size)
    values ('Missing Format', 80)$$,
  '23502',
  null,
  'target_faces.formatを省略した作成はNOT NULL制約で拒否される'
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

insert into public.target_faces (id, name, size, format, bow_type)
values ('22222222-2222-2222-2222-222222222222', 'My Target', 80, 'outdoor', array['recurve', 'compound', 'barebow']);

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
