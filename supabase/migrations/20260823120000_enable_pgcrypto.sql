begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- seed.sqlのcrypt()/gen_salt()に必要。ローカルはプリインストール済みだが、
-- リモート（Preview/本番）では明示的に有効化しないと存在しない。
create extension if not exists pgcrypto with schema extensions;

commit;
