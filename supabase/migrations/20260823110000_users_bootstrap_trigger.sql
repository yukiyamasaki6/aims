begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- auth.users への新規行作成をトリガーに、対応する public.users 行を自動生成する。
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id)
  values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function handle_new_user();

commit;
