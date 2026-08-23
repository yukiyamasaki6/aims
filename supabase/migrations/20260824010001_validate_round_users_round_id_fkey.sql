begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

alter table round_users
  validate constraint round_users_round_id_fkey;

commit;
