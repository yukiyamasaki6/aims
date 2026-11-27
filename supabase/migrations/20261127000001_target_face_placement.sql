-- 的の名称(name)を削除し、スポットの配置の分類(placement)を追加する。
-- 列の追加、割り当て、制約、削除は1つのトランザクションで原子的に行う必要がある。書き込みの停止は`lock_timeout`で上限を付ける。
-- squawk-ignore-file ban-drop-column, adding-not-nullable-field, constraint-missing-not-valid, prefer-robust-stmts
-- トランザクション制御(begin/commit)は書かない(squawkの`prefer-robust-stmts`は上で無視する)。適用はCLIが1ファイルを1トランザクションで行う。
set lock_timeout = '1s';
set statement_timeout = '5s';

alter table public.target_faces add column placement text;

-- 割り当ては固定のIDで行う。ここに無い的は`placement`がNULLのまま残り、NOT NULLで適用が失敗する。
update public.target_faces
set placement = 'single'
where id in (
  'a1000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000002',
  'a1000000-0000-0000-0000-000000000003',
  'a1000000-0000-0000-0000-000000000004',
  'a1000000-0000-0000-0000-000000000007',
  'a1000000-0000-0000-0000-000000000010',
  'a1000000-0000-0000-0000-000000000011',
  'a1000000-0000-0000-0000-000000000012',
  'b1000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000002'
);

update public.target_faces
set placement = 'triangle'
where id in (
  'a1000000-0000-0000-0000-000000000005',
  'a1000000-0000-0000-0000-000000000008',
  'b1000000-0000-0000-0000-000000000003',
  'b1000000-0000-0000-0000-000000000005'
);

update public.target_faces
set placement = 'vertical'
where id in (
  'a1000000-0000-0000-0000-000000000006',
  'a1000000-0000-0000-0000-000000000009',
  'a1000000-0000-0000-0000-000000000013',
  'b1000000-0000-0000-0000-000000000004',
  'b1000000-0000-0000-0000-000000000006'
);

alter table public.target_faces alter column placement set not null;
alter table public.target_faces
  add constraint target_faces_placement_check
  check (placement in ('single', 'triangle', 'vertical'));

alter table public.target_faces drop column name;
