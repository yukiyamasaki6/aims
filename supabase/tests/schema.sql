begin;

select plan(2);

select tables_are(
  'public',
  array[
    'distances',
    'round_preset_distances',
    'round_presets',
    'round_users',
    'rounds',
    'shots',
    'target_face_rings',
    'target_face_spots',
    'target_faces',
    'users'
  ],
  'publicスキーマのテーブルは想定通りの集合と完全に一致する'
);

select col_is_unique(
  'public', 'shots', array['distance_id', 'user_id', 'end_number', 'arrow_number'],
  'shots は (distance_id, user_id, end_number, arrow_number) で一意'
);

select * from finish();

rollback;
