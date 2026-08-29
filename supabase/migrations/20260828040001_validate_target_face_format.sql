begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

alter table target_faces validate constraint target_faces_format_not_null;

alter table target_faces alter column format set not null;

alter table target_faces drop constraint target_faces_format_not_null;

commit;
