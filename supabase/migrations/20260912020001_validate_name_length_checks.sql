begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

alter table rounds validate constraint rounds_name_length;
alter table round_presets validate constraint round_presets_name_length;

commit;
