begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- squawk-ignore ban-drop-table
drop table if exists memos;

commit;
