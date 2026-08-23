begin;

select plan(2);

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

select * from finish();

rollback;
