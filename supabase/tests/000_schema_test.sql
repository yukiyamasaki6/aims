begin;

select plan(7);

select hasnt_table('public', 'memos', 'memos テーブルは削除されている');

select has_table('public', 'users', 'users テーブルが存在する');
select has_table('public', 'rounds', 'rounds テーブルが存在する');
select has_table('public', 'round_users', 'round_users テーブルが存在する');
select has_table('public', 'distances', 'distances テーブルが存在する');
select has_table('public', 'shots', 'shots テーブルが存在する');

select col_is_unique(
  'public', 'shots', array['distance_id', 'user_id', 'end_number', 'arrow_number'],
  'shots は (distance_id, user_id, end_number, arrow_number) で一意'
);

select * from finish();

rollback;
