begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- issue471: save_round_as_presetを、DBに保存済みのrounds/distancesを読み直す
-- 方式（サーバー起点）から、create_roundと同様にクライアントの表示状態を
-- そのまま送信する方式（ローカル起点）に変更する。プリセットは元のラウンド
-- と紐付かない独立したデータのため、p_round_idは不要になる。

DROP FUNCTION "public"."save_round_as_preset"("p_round_id" "uuid", "p_name" "text");

CREATE FUNCTION "public"."save_round_as_preset"("p_name" "text", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_preset_id uuid;
begin
  insert into preset_rounds (owner_id, name, format, bow_type)
  values (auth.uid(), p_name, p_format, p_bow_type)
  returning id into v_preset_id;

  insert into preset_distances (
    preset_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked
  )
  select
    v_preset_id,
    distance_input ->> 'position_key',
    (distance_input ->> 'distance')::bigint,
    (distance_input ->> 'total_ends')::bigint,
    (distance_input ->> 'arrows_per_end')::bigint,
    (distance_input ->> 'target_face_id')::uuid,
    (distance_input ->> 'is_marked')::boolean
  from jsonb_array_elements(p_distances) as distance_input;

  return v_preset_id;
end;
$$;

ALTER FUNCTION "public"."save_round_as_preset"("p_name" "text", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") OWNER TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."save_round_as_preset"("p_name" "text", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") TO "authenticated";

commit;
