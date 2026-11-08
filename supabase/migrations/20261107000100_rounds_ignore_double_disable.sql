-- 消えている矢・ラウンドを別の操作IDで消す要求は、書かずに効かない結果(DISABLED)で返す。
-- 同じ操作IDの再送は、今までどおり既存のrevisionを返す。

begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

CREATE OR REPLACE FUNCTION "public"."clear_shots"("p_shots" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_shot jsonb;
  v_distance_id uuid;
  v_round_id uuid;
  v_round_disabled_at timestamptz;
  v_distance_disabled_at timestamptz;
  v_shot_id uuid;
  v_row_distance_id uuid;
  v_row_end bigint;
  v_row_disabled_at timestamptz;
  v_new_revision bigint;
  v_event_revision bigint;
  v_results jsonb := '[]'::jsonb;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  -- 契約の検証。shot_idの無い要素は拒否する。
  if p_shots is null or jsonb_typeof(p_shots) <> 'array' or jsonb_array_length(p_shots) > 100 then
    raise exception '矢の取り消しは100件以下の配列で指定してください。' using errcode = 'PT422';
  end if;
  for v_shot in select * from jsonb_array_elements(p_shots)
  loop
    if jsonb_typeof(v_shot) <> 'object'
      or coalesce(jsonb_typeof(v_shot -> 'distance_id'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'shot_event_id'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'shot_id'), '') <> 'string'
      or coalesce((v_shot ->> 'distance_id') !~ v_uuid_re, true)
      or coalesce((v_shot ->> 'shot_event_id') !~ v_uuid_re, true)
      or coalesce((v_shot ->> 'shot_id') !~ v_uuid_re, true) then
      raise exception '矢の取り消しの指定が不正です。' using errcode = 'PT422';
    end if;
  end loop;

  -- 得点の記録・取消と距離構成の変更を、distanceの行ロックで同じ直列化境界に置く。
  -- 送信器の要求は距離ごとの1件だけで、複数の距離を逆順で処理する別クライアントは無いため、ID順にはしない。
  for v_distance_id in
    select distinct (shot ->> 'distance_id')::uuid
    from jsonb_array_elements(p_shots) as shot
  loop
    v_round_id := null;
    select d.round_id into v_round_id
    from distances d
    where d.id = v_distance_id
    for update;

    if v_round_id is not null and not is_round_editor(v_round_id) then
      raise exception 'この距離の矢を取り消す権限がありません。' using errcode = 'PT403';
    end if;
  end loop;

  for v_shot in select * from jsonb_array_elements(p_shots)
  loop
    v_distance_id := (v_shot ->> 'distance_id')::uuid;
    v_shot_id := (v_shot ->> 'shot_id')::uuid;

    select d.round_id, d.disabled_at, r.disabled_at
      into v_round_id, v_distance_disabled_at, v_round_disabled_at
    from distances d
    join rounds r on r.id = d.round_id
    where d.id = v_distance_id;

    if not found then
      v_results := v_results || jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'MISSING');
      continue;
    end if;

    select revision into v_event_revision from shot_events where event_id = (v_shot ->> 'shot_event_id')::uuid;
    if found then
      v_results := v_results || jsonb_build_object('revision', v_event_revision, 'applied', true, 'reason', null::text);
      continue;
    end if;

    if v_round_disabled_at is not null or v_distance_disabled_at is not null then
      v_results := v_results || jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'DISABLED');
      continue;
    end if;

    select distance_id, end_number, disabled_at into v_row_distance_id, v_row_end, v_row_disabled_at from shots where id = v_shot_id;
    if not found then
      v_results := v_results || jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'MISSING');
      continue;
    end if;
    if v_row_distance_id <> v_distance_id then
      raise exception '矢の距離が記録と一致しません。' using errcode = 'PT422';
    end if;

    -- 消えている矢を別の操作IDで消す要求は、書かずに効かない結果で返す(履歴に同じ消去を並べない)。
    if v_row_disabled_at is not null then
      v_results := v_results || jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'DISABLED');
      continue;
    end if;

    select greatest(
      (select max(e.revision) from shot_events e where e.shot_id = v_shot_id),
      (select s.revision from shots s where s.id = v_shot_id),
      0
    ) + 1 into v_new_revision;

    insert into shot_events (event_id, distance_id, shot_id, type, author_id, revision, end_number)
    values (
      (v_shot ->> 'shot_event_id')::uuid, v_distance_id, v_shot_id, 'CLEARED', auth.uid(), v_new_revision, v_row_end
    );

    update shots
    set disabled_at = clock_timestamp(), revision = v_new_revision
    where id = v_shot_id;

    v_results := v_results || jsonb_build_object('revision', v_new_revision, 'applied', true, 'reason', null::text);
  end loop;

  return v_results;
end;
$_$;


ALTER FUNCTION "public"."clear_shots"("p_shots" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."disable_round"("p_round_event_id" "uuid", "p_round_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_revision bigint;
  v_disabled_at timestamptz;
  v_event_revision bigint;
begin
  select revision, disabled_at into v_revision, v_disabled_at
  from rounds
  where id = p_round_id
  for update;

  if v_revision is null or not is_round_editor(p_round_id) then
    raise exception 'このラウンドを削除する権限がありません。' using errcode = 'PT403';
  end if;

  select revision into v_event_revision from round_events where event_id = p_round_event_id;
  if found then
    return jsonb_build_object('revision', v_event_revision, 'applied', true, 'reason', null::text);
  end if;

  -- 削除済みのラウンドは書かない(revisionも削除の時刻も変えない)。
  if v_disabled_at is not null then
    return jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'DISABLED');
  end if;

  insert into round_events (event_id, round_id, type, author_id, revision)
  values (p_round_event_id, p_round_id, 'DISABLED', auth.uid(), v_revision + 1);

  update rounds
  set disabled_at = clock_timestamp(), revision = v_revision + 1
  where id = p_round_id;

  return jsonb_build_object('revision', v_revision + 1, 'applied', true, 'reason', null::text);
end;
$$;


ALTER FUNCTION "public"."disable_round"("p_round_event_id" "uuid", "p_round_id" "uuid") OWNER TO "postgres";

commit;
