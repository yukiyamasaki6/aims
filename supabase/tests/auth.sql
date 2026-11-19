begin;

select plan(6);

insert into auth.users (id) values ('55555555-5555-5555-5555-555555555555');

select results_eq(
  $$select count(*) from public.users where id = '55555555-5555-5555-5555-555555555555'$$,
  $$values (1::bigint)$$,
  'auth.usersへの新規作成でpublic.usersが自動生成される'
);

select is(
  (select id from public.users where id = '55555555-5555-5555-5555-555555555555'),
  '55555555-5555-5555-5555-555555555555'::uuid,
  'public.usersのidはauth.users.idと一致する'
);

-- Hookの方式とclaims不変性を全行比較する。
create temp table hook_cases(method jsonb, allowed boolean);
insert into hook_cases values
 ('"otp"', true), ('"token_refresh"', true), ('"email_change"', true),
 ('"password"', false), ('"recovery"', false), ('"unexpected"', false),
 ('null', false), ('123', false), ('{}', false), ('[]', false), (null, false);
create temp table hook_actual as
select method, allowed,
 public.email_otp_access_token_hook(
   case when method is null then '{}'::jsonb else jsonb_build_object('authentication_method', method) end
   || jsonb_build_object('claims', jsonb_build_object('sub', '55555555-5555-5555-5555-555555555555', 'amr', jsonb_build_array(jsonb_build_object('method','password','timestamp',1), jsonb_build_object('method','otp','timestamp',2))))) as actual,
 case when allowed then jsonb_build_object('claims', jsonb_build_object('sub', '55555555-5555-5555-5555-555555555555', 'amr', jsonb_build_array(jsonb_build_object('method','password','timestamp',1), jsonb_build_object('method','otp','timestamp',2))))
 else '{"error":{"http_code":403,"message":"authentication_method_not_allowed"}}'::jsonb end as expected
from hook_cases;
select is_empty($$select * from hook_actual where actual is distinct from expected$$, '許可方式はclaimsを保ち他方式と欠落は過去のOTPによらず403になる');
select results_eq(
 $$select role_name, has_function_privilege(role_name, 'public.email_otp_access_token_hook(jsonb)', 'execute') from (values ('supabase_auth_admin'), ('anon'), ('authenticated')) r(role_name) order by role_name$$,
 $$values ('anon'::text,false), ('authenticated'::text,false), ('supabase_auth_admin'::text,true)$$,
 'HookはAuth管理ロールだけに実行を許可する');
select ok(has_schema_privilege('supabase_auth_admin','public','usage') and not (select prosecdef from pg_proc where oid='public.email_otp_access_token_hook(jsonb)'::regprocedure), 'Auth管理ロールはschemaを使用できHookはSECURITY INVOKERである');
select ok(to_regprocedure('public.delete_account()') is null, '引数なしの旧削除RPCは存在しない');

select * from finish();

rollback;
