-- 矢数・エンド数の制約トリガーと、距離のID順のロックを外し、disable_roundの戻り値を他のRPCと同じjsonbにする。
-- 書き込みはRPCだけで、record_shotsは書く前に空きを判定し、update_distanceは更新の検証で同じ判定を持つ。

begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

CREATE OR REPLACE FUNCTION "public"."record_shots"("p_shots" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_shot jsonb;
  v_distance_id uuid;
  v_round_id uuid;
  v_round_disabled_at timestamptz;
  v_distance_disabled_at timestamptz;
  v_total_ends bigint;
  v_arrows_per_end bigint;
  v_target_face_id uuid;
  v_shot_id uuid;
  v_end bigint;
  v_score_str text;
  v_score_int bigint;
  v_has_shooter boolean;
  v_has_shot_number boolean;
  v_shooter_id uuid;
  v_row shots%rowtype;
  v_row_found boolean;
  v_reviving boolean;
  v_shot_number bigint;
  v_set_shot_number boolean;
  v_applied text[];
  v_rejected jsonb;
  v_keys text[];
  v_new_revision bigint;
  v_event_revision bigint;
  v_event_set_fields text[];
  v_results jsonb := '[]'::jsonb;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  -- 契約の検証。shot_idの無い要素は拒否する。
  if p_shots is null or jsonb_typeof(p_shots) <> 'array' or jsonb_array_length(p_shots) > 100 then
    raise exception '矢の記録は100件以下の配列で指定してください。' using errcode = 'PT422';
  end if;
  for v_shot in select * from jsonb_array_elements(p_shots)
  loop
    if jsonb_typeof(v_shot) <> 'object'
      or coalesce(jsonb_typeof(v_shot -> 'distance_id'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'shot_event_id'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'shot_id'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'end_number'), '') <> 'number'
      or coalesce(jsonb_typeof(v_shot -> 'score_str'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'score_int'), '') <> 'number'
      or coalesce((v_shot ->> 'distance_id') !~ v_uuid_re, true)
      or coalesce((v_shot ->> 'shot_event_id') !~ v_uuid_re, true)
      or coalesce((v_shot ->> 'shot_id') !~ v_uuid_re, true)
      or coalesce((v_shot #>> '{end_number}') !~ '^[1-9][0-9]{0,15}$', true)
      or coalesce((v_shot #>> '{score_int}') !~ '^-?[0-9]{1,15}$', true)
      or (v_shot ->> 'score_str') = ''
      or (
        v_shot ? 'shooter_id'
        and (jsonb_typeof(v_shot -> 'shooter_id') <> 'string' or coalesce((v_shot ->> 'shooter_id') !~ v_uuid_re, true))
      )
      or (
        v_shot ? 'shot_number'
        and jsonb_typeof(v_shot -> 'shot_number') <> 'null'
        and (jsonb_typeof(v_shot -> 'shot_number') <> 'number' or (v_shot #>> '{shot_number}') !~ '^-?[0-9]{1,9}$')
      ) then
      raise exception '矢の記録の指定が不正です。' using errcode = 'PT422';
    end if;
  end loop;

  -- バッチ内のdistanceをロックする。送信器の要求は距離ごとの1件だけで、ID順にはしない。
  -- 存在しない距離は、要素ごとにMISSINGとして返す。
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
      raise exception 'この距離に矢を記録する権限がありません。' using errcode = 'PT403';
    end if;
  end loop;

  for v_shot in select * from jsonb_array_elements(p_shots)
  loop
    v_distance_id := (v_shot ->> 'distance_id')::uuid;
    v_shot_id := (v_shot ->> 'shot_id')::uuid;
    v_end := (v_shot ->> 'end_number')::bigint;
    v_score_str := v_shot ->> 'score_str';
    v_score_int := (v_shot ->> 'score_int')::bigint;
    v_has_shooter := v_shot ? 'shooter_id';
    v_has_shot_number := v_shot ? 'shot_number';

    select d.round_id, d.disabled_at, d.total_ends, d.arrows_per_end, d.target_face_id, r.disabled_at
      into v_round_id, v_distance_disabled_at, v_total_ends, v_arrows_per_end, v_target_face_id, v_round_disabled_at
    from distances d
    join rounds r on r.id = d.round_id
    where d.id = v_distance_id;

    if not found then
      v_results := v_results || jsonb_build_object(
        'revision', null::bigint, 'applied', false, 'applied_fields', null::text[],
        'rejected_fields', '[]'::jsonb, 'reason', 'MISSING'
      );
      continue;
    end if;

    -- 効いた操作の再送は、記録した属性を効いた項目として返す。要素にあって記録に無い属性はREJECTEDとする。
    select revision, set_fields into v_event_revision, v_event_set_fields
    from shot_events where event_id = (v_shot ->> 'shot_event_id')::uuid;
    if found then
      v_applied := coalesce(v_event_set_fields, array['score', 'shooter_id', 'shot_number']);
      v_keys := array['score'];
      if v_has_shooter then
        v_keys := array_append(v_keys, 'shooter_id');
      end if;
      if v_has_shot_number then
        v_keys := array_append(v_keys, 'shot_number');
      end if;
      v_results := v_results || jsonb_build_object(
        'revision', v_event_revision,
        'applied', true,
        'applied_fields', to_jsonb(v_applied),
        'rejected_fields', (
          select coalesce(jsonb_agg(jsonb_build_object('field', k, 'reason', 'REJECTED')), '[]'::jsonb)
          from unnest(v_keys) k
          where k <> all (v_applied)
        ),
        'reason', null::text
      );
      continue;
    end if;

    -- shooter_idは「誰の代理で記録するか」を選ぶだけであり、権限自体は上のis_round_editor()で判定済みなので、
    -- author_idに相当する実行者情報がクライアント入力に左右されることはない。
    if v_has_shooter then
      v_shooter_id := (v_shot ->> 'shooter_id')::uuid;
      if not exists (
        select 1 from round_users
        where round_id = v_round_id and user_id = v_shooter_id
      ) then
        raise exception '指定された射手はこのラウンドのメンバーではありません。' using errcode = 'PT403';
      end if;
    end if;

    if v_round_disabled_at is not null or v_distance_disabled_at is not null then
      v_results := v_results || jsonb_build_object(
        'revision', null::bigint, 'applied', false, 'applied_fields', null::text[],
        'rejected_fields', '[]'::jsonb, 'reason', 'DISABLED'
      );
      continue;
    end if;

    -- 矢を距離・エンドの間で移す操作は無い。別の距離・エンドの同じIDは契約の不一致とする。
    select * into v_row from shots where id = v_shot_id;
    v_row_found := found;
    if v_row_found and v_row.distance_id <> v_distance_id then
      raise exception '矢の距離が記録と一致しません。' using errcode = 'PT422';
    end if;
    if v_row_found and v_row.end_number <> v_end then
      raise exception '矢のエンドが記録と一致しません。' using errcode = 'PT422';
    end if;

    -- 記録後の射順（キーが無ければ行の値）で、構成に収まるかを判定する。
    if v_has_shot_number then
      v_shot_number := (v_shot ->> 'shot_number')::bigint;
    elsif v_row_found then
      v_shot_number := v_row.shot_number;
    else
      v_shot_number := null;
    end if;

    if not shot_fits(v_target_face_id, v_total_ends, v_arrows_per_end, v_end, v_shot_number, v_score_str, v_score_int) then
      v_results := v_results || jsonb_build_object(
        'revision', null::bigint, 'applied', false, 'applied_fields', null::text[],
        'rejected_fields', '[]'::jsonb, 'reason', 'UNFIT'
      );
      continue;
    end if;

    v_reviving := not v_row_found or v_row.disabled_at is not null;
    v_set_shot_number := v_has_shot_number;
    v_rejected := '[]'::jsonb;

    -- 射順が同じエンドの他の生きている矢と重なるなら、射順の項目だけを効かせない。
    if v_has_shot_number and v_shot_number is not null and exists (
      select 1 from shots
      where distance_id = v_distance_id and end_number = v_end and disabled_at is null
        and shot_number = v_shot_number and id <> v_shot_id
    ) then
      v_rejected := v_rejected || jsonb_build_object('field', 'shot_number', 'reason', 'UNFIT');
      v_set_shot_number := false;
      v_shot_number := case when v_row_found then v_row.shot_number end;
    end if;

    -- 消した矢の復活で、行の射順が他の生きている矢と重なるなら、射順をnullにして復活させる。
    if v_reviving and not v_set_shot_number and v_shot_number is not null and exists (
      select 1 from shots
      where distance_id = v_distance_id and end_number = v_end and disabled_at is null
        and shot_number = v_shot_number and id <> v_shot_id
    ) then
      v_set_shot_number := true;
      v_shot_number := null;
    end if;

    -- 生きている矢を増やす記録（新しい矢、復活）は、エンドに空きがあるときだけ効かせる。
    if v_reviving and (
      select count(*) from shots
      where distance_id = v_distance_id and end_number = v_end and disabled_at is null
    ) >= v_arrows_per_end then
      v_results := v_results || jsonb_build_object(
        'revision', null::bigint, 'applied', false, 'applied_fields', null::text[],
        'rejected_fields', '[]'::jsonb, 'reason', 'UNFIT'
      );
      continue;
    end if;

    -- 新しい矢では射手を必ず決めるため、射手は効いた属性になる。
    v_applied := array['score'];
    if v_has_shooter or not v_row_found then
      v_applied := array_append(v_applied, 'shooter_id');
    end if;
    if v_set_shot_number then
      v_applied := array_append(v_applied, 'shot_number');
    end if;

    if not v_has_shooter then
      v_shooter_id := case when v_row_found then v_row.shooter_id else auth.uid() end;
    end if;

    -- 矢のイベントと射影の両方のrevisionを見て採番する。
    select greatest(
      (select max(e.revision) from shot_events e where e.shot_id = v_shot_id),
      (select s.revision from shots s where s.id = v_shot_id),
      0
    ) + 1 into v_new_revision;

    insert into shot_events (
      event_id, distance_id, shot_id, type, author_id, revision, end_number,
      shooter_id, score_str, score_int, shot_number, set_fields
    )
    values (
      (v_shot ->> 'shot_event_id')::uuid, v_distance_id, v_shot_id, 'RECORDED', auth.uid(), v_new_revision, v_end,
      v_shooter_id, v_score_str, v_score_int,
      case when v_set_shot_number then v_shot_number end,
      v_applied
    );

    if v_row_found then
      update shots
      set
        score_str = v_score_str,
        score_int = v_score_int,
        shooter_id = v_shooter_id,
        shot_number = case when v_set_shot_number then v_shot_number else shot_number end,
        revision = v_new_revision,
        disabled_at = null
      where id = v_shot_id;
    else
      insert into shots (id, distance_id, end_number, shooter_id, score_str, score_int, shot_number, revision)
      values (v_shot_id, v_distance_id, v_end, v_shooter_id, v_score_str, v_score_int, v_shot_number, v_new_revision);
    end if;

    v_results := v_results || jsonb_build_object(
      'revision', v_new_revision, 'applied', true, 'applied_fields', to_jsonb(v_applied),
      'rejected_fields', v_rejected, 'reason', null::text
    );
  end loop;

  return v_results;
end;
$_$;


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

    select distance_id, end_number into v_row_distance_id, v_row_end from shots where id = v_shot_id;
    if not found then
      v_results := v_results || jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'MISSING');
      continue;
    end if;
    if v_row_distance_id <> v_distance_id then
      raise exception '矢の距離が記録と一致しません。' using errcode = 'PT422';
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

ALTER FUNCTION "public"."record_shots"("p_shots" "jsonb") OWNER TO "postgres";


ALTER FUNCTION "public"."clear_shots"("p_shots" "jsonb") OWNER TO "postgres";


DROP TRIGGER "distances_capacity_guard" ON "public"."distances";


DROP TRIGGER "shots_capacity_guard" ON "public"."shots";


DROP FUNCTION "public"."distances_capacity_guard"();


DROP FUNCTION "public"."shots_capacity_guard"();


-- 戻り値の型がbigintからjsonbに変わるため、関数を作り直す。
DROP FUNCTION "public"."disable_round"("p_round_event_id" "uuid", "p_round_id" "uuid");


CREATE FUNCTION "public"."disable_round"("p_round_event_id" "uuid", "p_round_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_revision bigint;
  v_event_revision bigint;
begin
  select revision into v_revision
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

  insert into round_events (event_id, round_id, type, author_id, revision)
  values (p_round_event_id, p_round_id, 'DISABLED', auth.uid(), v_revision + 1);

  update rounds
  set disabled_at = coalesce(disabled_at, clock_timestamp()), revision = v_revision + 1
  where id = p_round_id;

  return jsonb_build_object('revision', v_revision + 1, 'applied', true, 'reason', null::text);
end;
$$;


ALTER FUNCTION "public"."disable_round"("p_round_event_id" "uuid", "p_round_id" "uuid") OWNER TO "postgres";


REVOKE EXECUTE ON FUNCTION "public"."disable_round"("p_round_event_id" "uuid", "p_round_id" "uuid") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."disable_round"("p_round_event_id" "uuid", "p_round_id" "uuid") TO "authenticated";

commit;
