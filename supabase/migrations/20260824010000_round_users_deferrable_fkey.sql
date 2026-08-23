begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- create_round RPCはround_usersへの登録をroundsの作成より先に行うため、
-- その時点ではまだ参照先のroundsの行が存在しない。トランザクション終端まで
-- 検証を遅延させるdeferrable initially deferredに変更する。
alter table round_users
  drop constraint round_users_round_id_fkey,
  add constraint round_users_round_id_fkey
    foreign key (round_id) references rounds (id) on delete cascade
    deferrable initially deferred
    not valid;

commit;
