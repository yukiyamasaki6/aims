begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- round_users・rounds・distancesの作成を1つのSECURITY DEFINER関数にまとめ、原子的に行う。
-- round_usersへの登録をroundsの作成より先に行うことで、rounds作成時のRETURNING
-- （supabase-jsの.select()等が要求する挿入直後のSELECTポリシー評価）が
-- round_usersを正しく参照できるようにする。
create or replace function create_round(p_name text, p_round_date date, p_distances jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round_id uuid := gen_random_uuid();
  v_distance jsonb;
  v_distance_number bigint := 0;
begin
  insert into round_users (round_id, user_id, role)
  values (v_round_id, auth.uid(), 'editor');

  insert into rounds (id, name, round_date)
  values (v_round_id, p_name, p_round_date);

  for v_distance in select * from jsonb_array_elements(p_distances)
  loop
    v_distance_number := v_distance_number + 1;
    insert into distances (round_id, distance_number, distance, total_ends, arrows_per_end)
    values (
      v_round_id,
      v_distance_number,
      (v_distance ->> 'distance')::bigint,
      (v_distance ->> 'total_ends')::bigint,
      (v_distance ->> 'arrows_per_end')::bigint
    );
  end loop;

  return v_round_id;
end;
$$;

grant execute on function create_round(text, date, jsonb) to authenticated;

-- 上記関数がround_usersの登録を明示的に行うため、AFTERトリガーは不要になった。
-- 残しておくと関数内のroundsへのINSERTと二重に登録され一意制約違反になる。
drop trigger on_round_created on rounds;
drop function handle_new_round();

-- ラウンド作成はcreate_round関数（SECURITY DEFINERでRLSを回避）経由のみとし、
-- クライアントからのroundsへの直接INSERTは許可しない。
drop policy "insert_any_authenticated" on rounds;

commit;
