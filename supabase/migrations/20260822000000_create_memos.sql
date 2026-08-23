begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

create table if not exists memos (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  created_at timestamptz not null default now()
);

alter table memos enable row level security;

-- Local動作確認用のため、anon ロールに全操作を許可する
create policy "Allow anon full access to memos"
  on memos
  for all
  to anon
  using (true)
  with check (true);

grant select, insert, update, delete on memos to anon;

commit;
