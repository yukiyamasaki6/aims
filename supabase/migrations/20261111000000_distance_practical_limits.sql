-- 距離(m)・総エンド数・矢数に実用上の上限(距離100、総エンド数60、矢数12)を設ける。
--   - distancesとpreset_distancesの3列にCHECK制約を足す(RPCを通らない書き込みと判定漏れの最後の砦)
--   - 上限の判定関数distance_config_over_limitを足す
--   - create_round、create_distance、update_distance、save_round_as_presetは、書く前にこの関数で判定し、超過をPT422で拒否する
-- 既存の行は更新しない。上限は、フロントエンドのDISTANCE_LIMITSと同じ値にする(単体テストが一致を検査する)。

begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- 6本とも、行数が少ない表への追加で、既存の行を検査する通常のCHECKにする(NOT VALIDにしない)。
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "public"."distances" ADD CONSTRAINT "distances_distance_max" CHECK ((("distance" IS NULL) OR ("distance" <= 100)));
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "public"."distances" ADD CONSTRAINT "distances_total_ends_max" CHECK (("total_ends" <= 60));
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "public"."distances" ADD CONSTRAINT "distances_arrows_per_end_max" CHECK (("arrows_per_end" <= 12));
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "public"."preset_distances" ADD CONSTRAINT "preset_distances_distance_max" CHECK ((("distance" IS NULL) OR ("distance" <= 100)));
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "public"."preset_distances" ADD CONSTRAINT "preset_distances_total_ends_max" CHECK (("total_ends" <= 60));
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "public"."preset_distances" ADD CONSTRAINT "preset_distances_arrows_per_end_max" CHECK (("arrows_per_end" <= 12));

-- いずれかの項目が上限を超えるとき真。NULLの項目は超過としない。
-- 上限の値を持つDB内の唯一の場所(CHECK制約のリテラルを除く)。
CREATE OR REPLACE FUNCTION "public"."distance_config_over_limit"("p_distance" numeric, "p_total_ends" numeric, "p_arrows_per_end" numeric) RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select coalesce(p_distance > 100, false)
    or coalesce(p_total_ends > 60, false)
    or coalesce(p_arrows_per_end > 12, false);
$$;

ALTER FUNCTION "public"."distance_config_over_limit"("p_distance" numeric, "p_total_ends" numeric, "p_arrows_per_end" numeric) OWNER TO "postgres";

REVOKE EXECUTE ON FUNCTION "public"."distance_config_over_limit"("p_distance" numeric, "p_total_ends" numeric, "p_arrows_per_end" numeric) FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."distance_config_over_limit"("p_distance" numeric, "p_total_ends" numeric, "p_arrows_per_end" numeric) TO "authenticated";

CREATE OR REPLACE FUNCTION "public"."create_distance"("p_distance_event_id" "uuid", "p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_format text;
  v_round_disabled_at timestamptz;
  v_event_revision bigint;
begin
  -- update_round/update_distanceと同じ親行をロックしてからformatを読む。
  select format, disabled_at into v_format, v_round_disabled_at
  from rounds
  where id = p_round_id
  for update;

  if v_format is null or not is_round_editor(p_round_id) then
    raise exception 'このラウンドに距離を追加する権限がありません。' using errcode = 'PT403';
  end if;

  select revision into v_event_revision from distance_events where event_id = p_distance_event_id;
  if found then
    return jsonb_build_object('revision', v_event_revision, 'applied', true, 'reason', null::text);
  end if;

  -- 契約の検証
  if p_id is null or p_position_key is null or p_position_key = ''
    or p_total_ends is null or p_total_ends < 1
    or p_arrows_per_end is null or p_arrows_per_end < 1
    or p_target_face_id is null or p_is_marked is null
    or (p_distance is not null and p_distance < 1) then
    raise exception '距離の指定が不正です。' using errcode = 'PT422';
  end if;
  if distance_config_over_limit(p_distance, p_total_ends, p_arrows_per_end) then
    raise exception '距離・総エンド数・矢数が上限を超えています。' using errcode = 'PT422';
  end if;
  if p_is_marked and p_distance is null then
    raise exception 'Markedの距離には距離(m)が必要です。' using errcode = 'PT422';
  end if;
  if not exists (select 1 from target_faces where id = p_target_face_id) then
    raise exception '指定された的が存在しません。' using errcode = 'PT422';
  end if;
  if exists (select 1 from distances where id = p_id) then
    raise exception '既に存在する距離IDです。' using errcode = 'PT422';
  end if;

  -- 規則の判定
  if v_round_disabled_at is not null then
    return jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'DISABLED');
  end if;
  if not p_is_marked and v_format <> 'field' then
    return jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'INVARIANT');
  end if;

  insert into distance_events (
    event_id, round_id, distance_id, type, author_id, revision,
    position_key, distance, is_marked, total_ends, arrows_per_end, target_face_id
  )
  values (
    p_distance_event_id, p_round_id, p_id, 'CREATED', auth.uid(), 1,
    p_position_key, p_distance, p_is_marked, p_total_ends, p_arrows_per_end, p_target_face_id
  );

  insert into distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked, revision)
  values (p_id, p_round_id, p_position_key, p_distance, p_total_ends, p_arrows_per_end, p_target_face_id, p_is_marked, 1);

  return jsonb_build_object('revision', 1, 'applied', true, 'reason', null::text);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."create_round"("p_round_event_id" "uuid", "p_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_round_id uuid := p_id;
  v_distance jsonb;
  v_event_type text;
  v_event_author uuid;
  v_ids uuid[] := '{}';
  v_event_ids uuid[] := '{}';
  v_id uuid;
  v_event_id uuid;
  v_target_face_id uuid;
  v_is_marked boolean;
  v_distance_value numeric;
  v_max constant numeric := 9223372036854775807;
begin
  -- 重複の判定（契約の検証より先。確定済みの作成の再送が、後から厳しくした検証で拒否されないため）
  select type, author_id into v_event_type, v_event_author
  from round_events where event_id = p_round_event_id;
  if found then
    if v_event_author <> auth.uid() then
      raise exception 'このラウンドを作成した操作ではありません。' using errcode = 'PT403';
    end if;
    if v_event_type <> 'CREATED' then
      raise exception 'イベントIDが作成以外の操作で使われています。' using errcode = 'PT422';
    end if;
    return jsonb_build_object('revision', 1, 'applied', true, 'reason', null::text);
  end if;

  -- 契約の検証
  if p_id is null or p_name is null or p_round_date is null or p_format is null or p_bow_type is null
    or char_length(p_name) > 50 then
    raise exception 'ラウンドの指定が不正です。' using errcode = 'PT422';
  end if;
  if p_format not in ('outdoor', 'indoor', 'field') then
    raise exception '種別が不正です。' using errcode = 'PT422';
  end if;
  if p_bow_type not in ('recurve', 'compound', 'barebow') then
    raise exception '弓種が不正です。' using errcode = 'PT422';
  end if;
  if p_distances is null or jsonb_typeof(p_distances) <> 'array' then
    raise exception '距離の指定が不正です。' using errcode = 'PT422';
  end if;

  for v_distance in select * from jsonb_array_elements(p_distances)
  loop
    if jsonb_typeof(v_distance) <> 'object'
      or jsonb_typeof(v_distance -> 'distance_event_id') is distinct from 'string'
      or jsonb_typeof(v_distance -> 'id') is distinct from 'string'
      or jsonb_typeof(v_distance -> 'target_face_id') is distinct from 'string'
      or jsonb_typeof(v_distance -> 'position_key') is distinct from 'string'
      or coalesce(v_distance ->> 'position_key', '') = ''
      or jsonb_typeof(v_distance -> 'is_marked') is distinct from 'boolean'
      or jsonb_typeof(v_distance -> 'total_ends') is distinct from 'number'
      or jsonb_typeof(v_distance -> 'arrows_per_end') is distinct from 'number'
      or jsonb_typeof(v_distance -> 'distance') not in ('number', 'null') then
      raise exception '距離の指定が不正です。' using errcode = 'PT422';
    end if;

    begin
      v_event_id := (v_distance ->> 'distance_event_id')::uuid;
      v_id := (v_distance ->> 'id')::uuid;
      v_target_face_id := (v_distance ->> 'target_face_id')::uuid;
    exception when invalid_text_representation then
      raise exception '距離の指定が不正です。' using errcode = 'PT422';
    end;

    v_is_marked := (v_distance ->> 'is_marked')::boolean;
    v_distance_value := (v_distance ->> 'distance')::numeric;
    if (v_distance ->> 'total_ends')::numeric < 1
      or (v_distance ->> 'total_ends')::numeric > v_max
      or (v_distance ->> 'total_ends')::numeric <> trunc((v_distance ->> 'total_ends')::numeric)
      or (v_distance ->> 'arrows_per_end')::numeric < 1
      or (v_distance ->> 'arrows_per_end')::numeric > v_max
      or (v_distance ->> 'arrows_per_end')::numeric <> trunc((v_distance ->> 'arrows_per_end')::numeric)
      or (v_distance_value is not null and (
        v_distance_value < 1 or v_distance_value > v_max or v_distance_value <> trunc(v_distance_value)
      )) then
      raise exception '距離の指定が不正です。' using errcode = 'PT422';
    end if;
    if distance_config_over_limit(
      v_distance_value, (v_distance ->> 'total_ends')::numeric, (v_distance ->> 'arrows_per_end')::numeric
    ) then
      raise exception '距離・総エンド数・矢数が上限を超えています。' using errcode = 'PT422';
    end if;
    if v_is_marked and v_distance_value is null then
      raise exception 'Markedの距離には距離(m)が必要です。' using errcode = 'PT422';
    end if;
    if p_format <> 'field' and not v_is_marked then
      raise exception 'Unmarkedの距離はフィールド種別でのみ使用できます。' using errcode = 'PT422';
    end if;
    if not exists (select 1 from target_faces where id = v_target_face_id) then
      raise exception '指定された的が存在しません。' using errcode = 'PT422';
    end if;
    if v_id = any (v_ids) or v_event_id = any (v_event_ids) then
      raise exception '距離のID・イベントIDが重複しています。' using errcode = 'PT422';
    end if;
    if exists (select 1 from distances where id = v_id) then
      raise exception '既に存在する距離IDです。' using errcode = 'PT422';
    end if;
    if exists (select 1 from distance_events where event_id = v_event_id) then
      raise exception '既に使われている距離のイベントIDです。' using errcode = 'PT422';
    end if;
    v_ids := v_ids || v_id;
    v_event_ids := v_event_ids || v_event_id;
  end loop;

  if exists (select 1 from rounds where id = p_id) then
    raise exception '既に存在するラウンドIDです。' using errcode = 'PT422';
  end if;

  -- 記録
  insert into round_events (event_id, round_id, type, author_id, revision, name, round_date, format, bow_type)
  values (p_round_event_id, v_round_id, 'CREATED', auth.uid(), 1, p_name, p_round_date, p_format, p_bow_type)
  on conflict (event_id) do nothing;

  if not found then
    return jsonb_build_object('revision', 1, 'applied', true, 'reason', null::text);
  end if;

  insert into rounds (id, name, round_date, format, bow_type, revision)
  values (v_round_id, p_name, p_round_date, p_format, p_bow_type, 1);

  insert into round_users (round_id, user_id, role)
  values (v_round_id, auth.uid(), 'editor');

  for v_distance in select * from jsonb_array_elements(p_distances)
  loop
    insert into distance_events (
      event_id, round_id, distance_id, type, author_id, revision,
      position_key, distance, is_marked, total_ends, arrows_per_end, target_face_id
    )
    values (
      (v_distance ->> 'distance_event_id')::uuid, v_round_id, (v_distance ->> 'id')::uuid, 'CREATED', auth.uid(), 1,
      v_distance ->> 'position_key', (v_distance ->> 'distance')::bigint, (v_distance ->> 'is_marked')::boolean,
      (v_distance ->> 'total_ends')::bigint, (v_distance ->> 'arrows_per_end')::bigint, (v_distance ->> 'target_face_id')::uuid
    );

    insert into distances (
      id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked, revision
    )
    values (
      (v_distance ->> 'id')::uuid, v_round_id, v_distance ->> 'position_key', (v_distance ->> 'distance')::bigint,
      (v_distance ->> 'total_ends')::bigint, (v_distance ->> 'arrows_per_end')::bigint,
      (v_distance ->> 'target_face_id')::uuid, (v_distance ->> 'is_marked')::boolean, 1
    );
  end loop;

  return jsonb_build_object('revision', 1, 'applied', true, 'reason', null::text);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."update_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid", "p_changes" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_round_id uuid;
  v_format text;
  v_round_disabled_at timestamptz;
  v_revision bigint;
  v_distance_disabled_at timestamptz;
  v_distance bigint;
  v_is_marked boolean;
  v_total_ends bigint;
  v_arrows_per_end bigint;
  v_target_face_id uuid;
  v_event_revision bigint;
  v_set_fields text[];
  v_keys text[];
  v_applied text[] := '{}';
  v_rejected jsonb := '[]'::jsonb;
  v_new_distance bigint;
  v_new_is_marked boolean;
  v_new_total_ends bigint;
  v_new_arrows_per_end bigint;
  v_new_target_face_id uuid;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  select round_id into v_round_id
  from distances
  where id = p_distance_id;

  -- 対象が存在しない（効かなかった距離の追加の後続）操作は、拒否せず、効かないと返す。
  -- 距離IDは端末が作る推測できないUUIDで、存在しないことだけを返すため、他のラウンドの情報は漏れない。
  if v_round_id is null then
    return jsonb_build_object(
      'revision', null::bigint, 'applied', false, 'applied_fields', null::text[],
      'rejected_fields', '[]'::jsonb, 'reason', 'MISSING'
    );
  end if;

  -- formatとis_markedの組合せを変える全RPCは親rounds行を先にロックする。
  select format, disabled_at into v_format, v_round_disabled_at
  from rounds
  where id = v_round_id
  for update;

  -- 得点の記録・取消も同じdistance行をロックするため、構成の変更と矢の記録を直列化する。
  select revision, disabled_at, distance, is_marked, total_ends, arrows_per_end, target_face_id
    into v_revision, v_distance_disabled_at, v_distance, v_is_marked, v_total_ends, v_arrows_per_end, v_target_face_id
  from distances
  where id = p_distance_id
  for update;

  if not is_round_editor(v_round_id) then
    raise exception 'この距離を編集する権限がありません。' using errcode = 'PT403';
  end if;

  select revision, set_fields into v_event_revision, v_set_fields
  from distance_events where event_id = p_distance_event_id;
  if found then
    -- 記録した項目を、差分のキー（構成の3項目はconfig）へ戻して返す。
    v_applied := coalesce(v_set_fields, array['distance', 'is_marked', 'total_ends', 'arrows_per_end', 'target_face_id']);
    v_applied := array(
      select k from unnest(array['distance', 'is_marked', 'config']) k
      where k = any (v_applied) or (k = 'config' and v_applied && array['total_ends', 'arrows_per_end', 'target_face_id'])
    );
    if jsonb_typeof(p_changes) = 'object' then
      select coalesce(array_agg(k), '{}') into v_keys from jsonb_object_keys(p_changes) k;
    else
      v_keys := '{}';
    end if;
    return jsonb_build_object(
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
  end if;

  -- 契約の検証
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception '距離の変更はキーを持つオブジェクトで指定してください。' using errcode = 'PT422';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_changes) k
    where k not in ('distance', 'is_marked', 'config')
  ) then
    raise exception '距離の変更に未知の項目が含まれています。' using errcode = 'PT422';
  end if;
  if p_changes ? 'distance' and jsonb_typeof(p_changes -> 'distance') <> 'null' and (
    jsonb_typeof(p_changes -> 'distance') <> 'number' or (p_changes #>> '{distance}') !~ '^[1-9][0-9]{0,15}$'
  ) then
    raise exception '距離(m)が不正です。' using errcode = 'PT422';
  end if;
  if p_changes ? 'distance' and distance_config_over_limit((p_changes #>> '{distance}')::numeric, null, null) then
    raise exception '距離・総エンド数・矢数が上限を超えています。' using errcode = 'PT422';
  end if;
  if p_changes ? 'is_marked' and jsonb_typeof(p_changes -> 'is_marked') <> 'boolean' then
    raise exception 'Marked/Unmarkedが不正です。' using errcode = 'PT422';
  end if;
  if p_changes ? 'config' then
    if jsonb_typeof(p_changes -> 'config') <> 'object'
      or (select count(*) from jsonb_object_keys(p_changes -> 'config')) <> 3
      or not ((p_changes -> 'config') ?& array['total_ends', 'arrows_per_end', 'target_face_id']) then
      raise exception '構成は的・エンド数・矢数の3項目で指定してください。' using errcode = 'PT422';
    end if;
    if jsonb_typeof(p_changes -> 'config' -> 'total_ends') <> 'number'
      or (p_changes #>> '{config,total_ends}') !~ '^[1-9][0-9]{0,15}$'
      or jsonb_typeof(p_changes -> 'config' -> 'arrows_per_end') <> 'number'
      or (p_changes #>> '{config,arrows_per_end}') !~ '^[1-9][0-9]{0,15}$'
      or jsonb_typeof(p_changes -> 'config' -> 'target_face_id') <> 'string'
      or (p_changes #>> '{config,target_face_id}') !~ v_uuid_re then
      raise exception '構成の値が不正です。' using errcode = 'PT422';
    end if;
    if distance_config_over_limit(
      null, (p_changes #>> '{config,total_ends}')::numeric, (p_changes #>> '{config,arrows_per_end}')::numeric
    ) then
      raise exception '距離・総エンド数・矢数が上限を超えています。' using errcode = 'PT422';
    end if;
    v_new_total_ends := (p_changes #>> '{config,total_ends}')::bigint;
    v_new_arrows_per_end := (p_changes #>> '{config,arrows_per_end}')::bigint;
    v_new_target_face_id := (p_changes #>> '{config,target_face_id}')::uuid;
    if not exists (select 1 from target_faces where id = v_new_target_face_id) then
      raise exception '指定された的が存在しません。' using errcode = 'PT422';
    end if;
  end if;
  if (p_changes -> 'is_marked') = 'true'::jsonb and (p_changes -> 'distance') = 'null'::jsonb then
    raise exception 'Markedにする変更と距離(m)の未設定を同時に指定できません。' using errcode = 'PT422';
  end if;

  -- 規則の判定: 削除済みのラウンド・距離は全項目が効かない。
  if v_round_disabled_at is not null or v_distance_disabled_at is not null then
    return jsonb_build_object(
      'revision', null::bigint, 'applied', false, 'applied_fields', null::text[],
      'rejected_fields', '[]'::jsonb, 'reason', 'DISABLED'
    );
  end if;

  -- Marked/Unmarkedを距離(m)より先に判定する。同じ操作の項目は同じ確定の順序なので、Markedの判定には同じ操作の距離(m)(保存後の値)を使う。
  -- 距離(m)を空にする変更は、Markedと同時には上のPT422で弾いている。
  if p_changes ? 'is_marked' then
    v_new_is_marked := (p_changes ->> 'is_marked')::boolean;
    if (not v_new_is_marked and v_format <> 'field')
      or (v_new_is_marked and (case when p_changes ? 'distance' then (p_changes #>> '{distance}')::bigint else v_distance end) is null) then
      v_rejected := v_rejected || jsonb_build_object('field', 'is_marked', 'reason', 'INVARIANT');
    else
      v_applied := array_append(v_applied, 'is_marked');
      v_is_marked := v_new_is_marked;
    end if;
  end if;

  if p_changes ? 'distance' then
    v_new_distance := (p_changes #>> '{distance}')::bigint;
    if v_new_distance is null and v_is_marked then
      v_rejected := v_rejected || jsonb_build_object('field', 'distance', 'reason', 'INVARIANT');
    else
      v_applied := array_append(v_applied, 'distance');
      v_distance := v_new_distance;
    end if;
  end if;

  if p_changes ? 'config' then
    if exists (
      select 1 from shots s
      where s.distance_id = p_distance_id
        and s.disabled_at is null
        and not shot_fits(v_new_target_face_id, v_new_total_ends, v_new_arrows_per_end, s.end_number, s.shot_number, s.score_str, s.score_int)
    ) or exists (
      select 1 from shots s
      where s.distance_id = p_distance_id
        and s.disabled_at is null
      group by s.end_number
      having count(*) > v_new_arrows_per_end
    ) then
      v_rejected := v_rejected || jsonb_build_object('field', 'config', 'reason', 'UNFIT');
    else
      v_applied := array_append(v_applied, 'config');
    end if;
  end if;

  if cardinality(v_applied) = 0 then
    return jsonb_build_object(
      'revision', null::bigint, 'applied', false, 'applied_fields', '[]'::jsonb,
      'rejected_fields', v_rejected, 'reason', null::text
    );
  end if;

  insert into distance_events (
    event_id, round_id, distance_id, type, author_id, revision, set_fields,
    position_key, distance, is_marked, total_ends, arrows_per_end, target_face_id
  )
  select
    p_distance_event_id, v_round_id, p_distance_id, 'UPDATED', auth.uid(), v_revision + 1,
    array(
      select f from unnest(array['distance', 'is_marked', 'total_ends', 'arrows_per_end', 'target_face_id']) f
      where (f = 'distance' and 'distance' = any (v_applied))
        or (f = 'is_marked' and 'is_marked' = any (v_applied))
        or (f in ('total_ends', 'arrows_per_end', 'target_face_id') and 'config' = any (v_applied))
    ),
    position_key,
    case when 'distance' = any (v_applied) then v_distance end,
    case when 'is_marked' = any (v_applied) then v_is_marked end,
    case when 'config' = any (v_applied) then v_new_total_ends end,
    case when 'config' = any (v_applied) then v_new_arrows_per_end end,
    case when 'config' = any (v_applied) then v_new_target_face_id end
  from distances where id = p_distance_id;

  update distances
  set
    distance = case when 'distance' = any (v_applied) then v_distance else distance end,
    is_marked = case when 'is_marked' = any (v_applied) then v_is_marked else is_marked end,
    total_ends = case when 'config' = any (v_applied) then v_new_total_ends else total_ends end,
    arrows_per_end = case when 'config' = any (v_applied) then v_new_arrows_per_end else arrows_per_end end,
    target_face_id = case when 'config' = any (v_applied) then v_new_target_face_id else target_face_id end,
    revision = v_revision + 1
  where id = p_distance_id;

  return jsonb_build_object(
    'revision', v_revision + 1, 'applied', true, 'applied_fields', to_jsonb(v_applied),
    'rejected_fields', v_rejected, 'reason', null::text
  );
end;
$_$;

CREATE OR REPLACE FUNCTION "public"."save_round_as_preset"("p_name" "text", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_preset_id uuid;
begin
  if exists (
    select 1 from jsonb_array_elements(p_distances) as distance_input
    where distance_config_over_limit(
      (distance_input ->> 'distance')::numeric,
      (distance_input ->> 'total_ends')::numeric,
      (distance_input ->> 'arrows_per_end')::numeric
    )
  ) then
    raise exception '距離・総エンド数・矢数が上限を超えています。' using errcode = 'PT422';
  end if;

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

commit;
