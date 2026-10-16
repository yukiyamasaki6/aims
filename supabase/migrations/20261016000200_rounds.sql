begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

CREATE TABLE IF NOT EXISTS "public"."distance_events" (
    "event_id" "uuid" PRIMARY KEY,
    "round_id" "uuid" NOT NULL,
    "distance_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "revision" bigint NOT NULL,
    "position_key" "text",
    "distance" bigint,
    "is_marked" boolean,
    "total_ends" bigint,
    "arrows_per_end" bigint,
    "target_face_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "set_fields" "text"[],
    CONSTRAINT "distance_events_payload_by_type" CHECK (((("type" = 'DISABLED'::"text") AND ("set_fields" IS NULL) AND ("position_key" IS NULL) AND ("distance" IS NULL) AND ("is_marked" IS NULL) AND ("total_ends" IS NULL) AND ("arrows_per_end" IS NULL) AND ("target_face_id" IS NULL)) OR (("type" = 'CREATED'::"text") AND ("set_fields" IS NULL) AND ("position_key" IS NOT NULL) AND ("is_marked" IS NOT NULL) AND ("total_ends" IS NOT NULL) AND ("arrows_per_end" IS NOT NULL) AND ("target_face_id" IS NOT NULL) AND (("is_marked" = false) OR ("distance" IS NOT NULL))) OR (("type" = 'UPDATED'::"text") AND ("set_fields" IS NOT NULL) AND ("cardinality"("set_fields") > 0) AND ("set_fields" <@ ARRAY['distance'::"text", 'is_marked'::"text", 'total_ends'::"text", 'arrows_per_end'::"text", 'target_face_id'::"text"]) AND ("position_key" IS NOT NULL) AND ((NOT ('is_marked'::"text" = ANY ("set_fields"))) OR ("is_marked" IS NOT NULL)) AND (('total_ends'::"text" = ANY ("set_fields")) = ('arrows_per_end'::"text" = ANY ("set_fields"))) AND (('total_ends'::"text" = ANY ("set_fields")) = ('target_face_id'::"text" = ANY ("set_fields"))) AND ((NOT ('total_ends'::"text" = ANY ("set_fields"))) OR (("total_ends" IS NOT NULL) AND ("arrows_per_end" IS NOT NULL) AND ("target_face_id" IS NOT NULL)))))),
    CONSTRAINT "distance_events_revision_positive" CHECK (("revision" >= 1)),
    CONSTRAINT "distance_events_type_check" CHECK (("type" = ANY (ARRAY['CREATED'::"text", 'UPDATED'::"text", 'DISABLED'::"text"])))
);


ALTER TABLE "public"."distance_events" OWNER TO "postgres";


COMMENT ON COLUMN "public"."distance_events"."set_fields" IS 'UPDATEDで効いた項目。作成と削除はnull';


CREATE TABLE IF NOT EXISTS "public"."distances" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "round_id" "uuid" NOT NULL,
    "distance" bigint,
    "total_ends" bigint NOT NULL,
    "arrows_per_end" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "target_face_id" "uuid" NOT NULL,
    "is_marked" boolean DEFAULT true NOT NULL,
    "position_key" "text" NOT NULL COLLATE "pg_catalog"."C",
    "revision" bigint DEFAULT 1 NOT NULL,
    "disabled_at" timestamp with time zone,
    CONSTRAINT "distances_arrows_per_end_positive" CHECK (("arrows_per_end" >= 1)),
    CONSTRAINT "distances_distance_positive" CHECK ((("distance" IS NULL) OR ("distance" >= 1))),
    CONSTRAINT "distances_marked_requires_distance" CHECK ((("is_marked" = false) OR ("distance" IS NOT NULL))),
    CONSTRAINT "distances_revision_check" CHECK (("revision" >= 1)),
    CONSTRAINT "distances_total_ends_positive" CHECK (("total_ends" >= 1))
);


ALTER TABLE "public"."distances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."round_events" (
    "event_id" "uuid" PRIMARY KEY,
    "round_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "revision" bigint NOT NULL,
    "name" "text",
    "round_date" "date",
    "format" "text",
    "bow_type" "text",
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "set_fields" "text"[],
    "status" "text",
    CONSTRAINT "round_events_payload_by_type" CHECK (((("type" = 'DISABLED'::"text") AND ("set_fields" IS NULL) AND ("name" IS NULL) AND ("round_date" IS NULL) AND ("format" IS NULL) AND ("bow_type" IS NULL) AND ("status" IS NULL)) OR (("type" = 'CREATED'::"text") AND ("set_fields" IS NULL) AND ("name" IS NOT NULL) AND ("round_date" IS NOT NULL) AND ("format" IS NOT NULL) AND ("bow_type" IS NOT NULL) AND ("status" IS NULL)) OR (("type" = 'UPDATED'::"text") AND ("set_fields" IS NOT NULL) AND ("cardinality"("set_fields") > 0) AND ("set_fields" <@ ARRAY['name'::"text", 'round_date'::"text", 'format'::"text", 'bow_type'::"text", 'status'::"text"]) AND ((NOT ('name'::"text" = ANY ("set_fields"))) OR ("name" IS NOT NULL)) AND ((NOT ('round_date'::"text" = ANY ("set_fields"))) OR ("round_date" IS NOT NULL)) AND ((NOT ('format'::"text" = ANY ("set_fields"))) OR ("format" IS NOT NULL)) AND ((NOT ('bow_type'::"text" = ANY ("set_fields"))) OR ("bow_type" IS NOT NULL)) AND ((NOT ('status'::"text" = ANY ("set_fields"))) OR ("status" IS NOT NULL))))),
    CONSTRAINT "round_events_revision_positive" CHECK (("revision" >= 1)),
    CONSTRAINT "round_events_status_check" CHECK ((("status" IS NULL) OR ("status" = ANY (ARRAY['in_progress'::"text", 'completed'::"text"])))),
    CONSTRAINT "round_events_type_check" CHECK (("type" = ANY (ARRAY['CREATED'::"text", 'UPDATED'::"text", 'DISABLED'::"text"])))
);


ALTER TABLE "public"."round_events" OWNER TO "postgres";


COMMENT ON COLUMN "public"."round_events"."set_fields" IS 'UPDATEDで効いた項目。作成と削除はnull';


COMMENT ON COLUMN "public"."round_events"."status" IS 'UPDATEDでstatusが効いたときの値。作成と、statusが効いていないUPDATEDはnull';


CREATE TABLE IF NOT EXISTS "public"."round_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "round_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "round_users_role_check" CHECK (("role" = ANY (ARRAY['editor'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."round_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rounds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "name" "text" NOT NULL,
    "round_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "format" "text" NOT NULL,
    "bow_type" "text" NOT NULL,
    "revision" bigint DEFAULT 1 NOT NULL,
    "disabled_at" timestamp with time zone,
    "status" "text" DEFAULT 'in_progress'::"text" NOT NULL,
    CONSTRAINT "rounds_bow_type_check" CHECK (("bow_type" = ANY (ARRAY['recurve'::"text", 'compound'::"text", 'barebow'::"text"]))),
    CONSTRAINT "rounds_format_check" CHECK (("format" = ANY (ARRAY['outdoor'::"text", 'indoor'::"text", 'field'::"text"]))),
    CONSTRAINT "rounds_name_length" CHECK (("char_length"("name") <= 50)),
    CONSTRAINT "rounds_revision_check" CHECK (("revision" >= 1)),
    CONSTRAINT "rounds_status_check" CHECK (("status" = ANY (ARRAY['in_progress'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."rounds" OWNER TO "postgres";


COMMENT ON COLUMN "public"."rounds"."status" IS 'ラウンドの状態。in_progress（入力中）かcompleted（完了）';


CREATE TABLE IF NOT EXISTS "public"."shot_events" (
    "event_id" "uuid" PRIMARY KEY,
    "distance_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "revision" bigint NOT NULL,
    "end_number" bigint NOT NULL,
    "shooter_id" "uuid",
    "score_str" "text",
    "score_int" bigint,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "shot_id" "uuid" NOT NULL,
    "shot_number" bigint,
    "set_fields" "text"[],
    CONSTRAINT "shot_events_payload_by_type" CHECK (((("type" = 'RECORDED'::"text") AND ("set_fields" IS NOT NULL) AND ('score'::"text" = ANY ("set_fields")) AND ("set_fields" <@ ARRAY['score'::"text", 'shooter_id'::"text", 'shot_number'::"text"]) AND ("shooter_id" IS NOT NULL) AND ("score_str" IS NOT NULL) AND ("score_int" IS NOT NULL) AND (('shot_number'::"text" = ANY ("set_fields")) OR ("shot_number" IS NULL))) OR (("type" = 'CLEARED'::"text") AND ("set_fields" IS NULL) AND ("shooter_id" IS NULL) AND ("score_str" IS NULL) AND ("score_int" IS NULL) AND ("shot_number" IS NULL)))),
    CONSTRAINT "shot_events_revision_positive" CHECK (("revision" >= 1)),
    CONSTRAINT "shot_events_shot_number_check" CHECK (("shot_number" >= 1)),
    CONSTRAINT "shot_events_type_check" CHECK (("type" = ANY (ARRAY['RECORDED'::"text", 'CLEARED'::"text"])))
);


ALTER TABLE "public"."shot_events" OWNER TO "postgres";


COMMENT ON COLUMN "public"."shot_events"."shot_id" IS '対象の矢のID';


COMMENT ON COLUMN "public"."shot_events"."shot_number" IS 'RECORDEDでset_fieldsにshot_numberを含むとき、記録した射順（nullは射順を外した）。それ以外はnull';


COMMENT ON COLUMN "public"."shot_events"."set_fields" IS 'RECORDEDで効いた属性（score、shooter_id、shot_number）。CLEAREDはnull';


CREATE TABLE IF NOT EXISTS "public"."shots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "distance_id" "uuid" NOT NULL,
    "end_number" bigint NOT NULL,
    "shooter_id" "uuid" NOT NULL,
    "score_str" "text" NOT NULL,
    "score_int" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revision" bigint DEFAULT 1 NOT NULL,
    "disabled_at" timestamp with time zone,
    "shot_number" bigint,
    CONSTRAINT "shots_revision_check" CHECK (("revision" >= 1)),
    CONSTRAINT "shots_shot_number_check" CHECK (("shot_number" >= 1))
);


ALTER TABLE "public"."shots" OWNER TO "postgres";


COMMENT ON COLUMN "public"."shots"."id" IS '矢のID。新しい矢は端末が作る時刻順のUUID（UUIDv7の形式）。点数の変更・消去・復活で変わらない';


COMMENT ON COLUMN "public"."shots"."shot_number" IS 'エンド内で何射目か。nullは射順不明。1以上・矢数以下で、同じエンドの生きている矢で重ならない';


ALTER TABLE ONLY "public"."distance_events"
    ADD CONSTRAINT "distance_events_distance_id_revision_key" UNIQUE ("distance_id", "revision");


ALTER TABLE ONLY "public"."round_events"
    ADD CONSTRAINT "round_events_round_id_revision_key" UNIQUE ("round_id", "revision");


ALTER TABLE ONLY "public"."round_users"
    ADD CONSTRAINT "round_users_round_id_user_id_key" UNIQUE ("round_id", "user_id");


ALTER TABLE ONLY "public"."shot_events"
    ADD CONSTRAINT "shot_events_shot_id_revision_key" UNIQUE ("shot_id", "revision");


CREATE INDEX "shots_live_end_idx" ON "public"."shots" USING "btree" ("distance_id", "end_number");


CREATE UNIQUE INDEX "shots_live_shot_number_key" ON "public"."shots" USING "btree" ("distance_id", "end_number", "shot_number") WHERE (("disabled_at" IS NULL) AND ("shot_number" IS NOT NULL));


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

  -- record_shotsと同じ順序でdistanceをロックし、得点の記録・取消と距離構成の変更を同じ直列化境界に置く。
  for v_distance_id in
    select distinct (shot ->> 'distance_id')::uuid
    from jsonb_array_elements(p_shots) as shot
    order by 1
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


ALTER FUNCTION "public"."clear_shots"("p_shots" "jsonb") OWNER TO "postgres";


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


ALTER FUNCTION "public"."create_distance"("p_distance_event_id" "uuid", "p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) OWNER TO "postgres";


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


ALTER FUNCTION "public"."create_round"("p_round_event_id" "uuid", "p_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."disable_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_round_id uuid;
  v_revision bigint;
  v_distance_disabled_at timestamptz;
  v_round_disabled_at timestamptz;
  v_event_revision bigint;
begin
  select round_id into v_round_id from distances where id = p_distance_id;

  if v_round_id is null then
    return jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'MISSING');
  end if;

  select revision, disabled_at into v_revision, v_distance_disabled_at
  from distances
  where id = p_distance_id
  for update;

  if not is_round_editor(v_round_id) then
    raise exception 'この距離を削除する権限がありません。' using errcode = 'PT403';
  end if;

  select revision into v_event_revision from distance_events where event_id = p_distance_event_id;
  if found then
    return jsonb_build_object('revision', v_event_revision, 'applied', true, 'reason', null::text);
  end if;

  select disabled_at into v_round_disabled_at from rounds where id = v_round_id;
  if v_distance_disabled_at is not null or v_round_disabled_at is not null then
    return jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'DISABLED');
  end if;

  insert into distance_events (event_id, round_id, distance_id, type, author_id, revision)
  values (p_distance_event_id, v_round_id, p_distance_id, 'DISABLED', auth.uid(), v_revision + 1);

  update distances
  set disabled_at = clock_timestamp(), revision = v_revision + 1
  where id = p_distance_id;

  return jsonb_build_object('revision', v_revision + 1, 'applied', true, 'reason', null::text);
end;
$$;


ALTER FUNCTION "public"."disable_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."disable_round"("p_round_event_id" "uuid", "p_round_id" "uuid") RETURNS bigint
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
    return v_event_revision;
  end if;

  insert into round_events (event_id, round_id, type, author_id, revision)
  values (p_round_event_id, p_round_id, 'DISABLED', auth.uid(), v_revision + 1);

  update rounds
  set disabled_at = coalesce(disabled_at, clock_timestamp()), revision = v_revision + 1
  where id = p_round_id;

  return v_revision + 1;
end;
$$;


ALTER FUNCTION "public"."disable_round"("p_round_event_id" "uuid", "p_round_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."distances_capacity_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  perform 1 from distances where id = new.id for update;

  if exists (
    select 1
    from shots
    where distance_id = new.id
      and disabled_at is null
    group by end_number
    having count(*) > new.arrows_per_end
  ) then
    raise exception 'エンドの矢が矢数を超えます。' using errcode = '23514';
  end if;

  return null;
end;
$$;


ALTER FUNCTION "public"."distances_capacity_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_round_editor"("target_round_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from round_users ru
    where ru.round_id = target_round_id and ru.user_id = auth.uid() and ru.role = 'editor'
  );
$$;


ALTER FUNCTION "public"."is_round_editor"("target_round_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_round_member"("target_round_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from round_users ru
    where ru.round_id = target_round_id and ru.user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_round_member"("target_round_id" "uuid") OWNER TO "postgres";


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

  -- バッチ内のdistanceをID順にロックする。同じ複数distanceを逆順で処理する
  -- 別クライアントともロック順が一致するため、デッドロックを避けられる。
  -- 存在しない距離は、要素ごとにMISSINGとして返す。
  for v_distance_id in
    select distinct (shot ->> 'distance_id')::uuid
    from jsonb_array_elements(p_shots) as shot
    order by 1
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


ALTER FUNCTION "public"."record_shots"("p_shots" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."shot_fits"("p_target_face_id" "uuid", "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_end" bigint, "p_shot_number" bigint, "p_score_str" "text", "p_score_int" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select p_end between 1 and p_total_ends
    and (p_shot_number is null or p_shot_number between 1 and p_arrows_per_end)
    and (
      (p_score_str = 'M' and p_score_int = 0)
      or exists (
        select 1
        from target_face_spots sp
        join target_face_rings r on r.spot_id = sp.id
        where sp.target_face_id = p_target_face_id
          and r.score_str = p_score_str
          and r.score_int = p_score_int
      )
    )
$$;


ALTER FUNCTION "public"."shot_fits"("p_target_face_id" "uuid", "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_end" bigint, "p_shot_number" bigint, "p_score_str" "text", "p_score_int" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."shots_capacity_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_arrows_per_end bigint;
  v_count bigint;
begin
  select arrows_per_end into v_arrows_per_end
  from distances
  where id = new.distance_id
  for update;

  select count(*) into v_count
  from shots
  where distance_id = new.distance_id
    and end_number = new.end_number
    and disabled_at is null;

  if v_count > v_arrows_per_end then
    raise exception 'エンドの矢が矢数を超えます。' using errcode = '23514';
  end if;

  return null;
end;
$$;


ALTER FUNCTION "public"."shots_capacity_guard"() OWNER TO "postgres";


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


ALTER FUNCTION "public"."update_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid", "p_changes" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_round"("p_round_event_id" "uuid", "p_round_id" "uuid", "p_changes" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_revision bigint;
  v_disabled_at timestamptz;
  v_format text;
  v_event_revision bigint;
  v_set_fields text[];
  v_keys text[];
  v_applied text[] := '{}';
  v_rejected jsonb := '[]'::jsonb;
  v_name text;
  v_round_date date;
  v_new_format text;
  v_bow_type text;
  v_status text;
  v_key text;
begin
  -- 距離の追加・更新も同じ親行を先にロックする。formatとis_markedの組合せの判定を
  -- 同じ直列化境界に置き、別の編集者がUnmarked距離を追加・変更できないようにする。
  select revision, disabled_at, format into v_revision, v_disabled_at, v_format
  from rounds
  where id = p_round_id
  for update;

  if v_revision is null or not is_round_editor(p_round_id) then
    raise exception 'このラウンドを編集する権限がありません。' using errcode = 'PT403';
  end if;

  select revision, set_fields into v_event_revision, v_set_fields
  from round_events where event_id = p_round_event_id;
  if found then
    v_applied := coalesce(v_set_fields, array['name', 'round_date', 'format', 'bow_type']);
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
    raise exception '設定の変更はキーを持つオブジェクトで指定してください。' using errcode = 'PT422';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_changes) k
    where k not in ('name', 'round_date', 'format', 'bow_type', 'status')
  ) then
    raise exception '設定の変更に未知の項目が含まれています。' using errcode = 'PT422';
  end if;
  if p_changes ? 'name' and (
    jsonb_typeof(p_changes -> 'name') <> 'string' or char_length(p_changes ->> 'name') > 50
  ) then
    raise exception 'ラウンド名が不正です。' using errcode = 'PT422';
  end if;
  if p_changes ? 'round_date' then
    if jsonb_typeof(p_changes -> 'round_date') <> 'string' or (p_changes ->> 'round_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception '実施日が不正です。' using errcode = 'PT422';
    end if;
    begin
      v_round_date := (p_changes ->> 'round_date')::date;
    exception when others then
      raise exception '実施日が不正です。' using errcode = 'PT422';
    end;
  end if;
  if p_changes ? 'format' and (
    jsonb_typeof(p_changes -> 'format') <> 'string'
    or (p_changes ->> 'format') not in ('outdoor', 'indoor', 'field')
  ) then
    raise exception '種別が不正です。' using errcode = 'PT422';
  end if;
  if p_changes ? 'bow_type' and (
    jsonb_typeof(p_changes -> 'bow_type') <> 'string'
    or (p_changes ->> 'bow_type') not in ('recurve', 'compound', 'barebow')
  ) then
    raise exception '弓種が不正です。' using errcode = 'PT422';
  end if;

  if p_changes ? 'status' and (
    jsonb_typeof(p_changes -> 'status') <> 'string'
    or (p_changes ->> 'status') not in ('in_progress', 'completed')
  ) then
    raise exception '状態が不正です。' using errcode = 'PT422';
  end if;

  -- 規則の判定: 削除済みのラウンドは全項目が効かない。
  if v_disabled_at is not null then
    return jsonb_build_object(
      'revision', null::bigint, 'applied', false, 'applied_fields', null::text[],
      'rejected_fields', '[]'::jsonb, 'reason', 'DISABLED'
    );
  end if;

  v_name := p_changes ->> 'name';
  v_new_format := p_changes ->> 'format';
  v_bow_type := p_changes ->> 'bow_type';
  v_status := p_changes ->> 'status';

  if p_changes ? 'name' then
    v_applied := array_append(v_applied, 'name');
  end if;
  if p_changes ? 'round_date' then
    v_applied := array_append(v_applied, 'round_date');
  end if;
  if p_changes ? 'format' then
    if v_new_format <> 'field' and exists (
      select 1 from distances
      where round_id = p_round_id and is_marked = false and disabled_at is null
    ) then
      v_rejected := v_rejected || jsonb_build_object('field', 'format', 'reason', 'INVARIANT');
    else
      v_applied := array_append(v_applied, 'format');
    end if;
  end if;
  if p_changes ? 'bow_type' then
    v_applied := array_append(v_applied, 'bow_type');
  end if;
  if p_changes ? 'status' then
    v_applied := array_append(v_applied, 'status');
  end if;

  if cardinality(v_applied) = 0 then
    return jsonb_build_object(
      'revision', null::bigint, 'applied', false, 'applied_fields', '[]'::jsonb,
      'rejected_fields', v_rejected, 'reason', null::text
    );
  end if;

  insert into round_events (event_id, round_id, type, author_id, revision, set_fields, name, round_date, format, bow_type, status)
  values (
    p_round_event_id, p_round_id, 'UPDATED', auth.uid(), v_revision + 1, v_applied,
    case when 'name' = any (v_applied) then v_name end,
    case when 'round_date' = any (v_applied) then v_round_date end,
    case when 'format' = any (v_applied) then v_new_format end,
    case when 'bow_type' = any (v_applied) then v_bow_type end,
    case when 'status' = any (v_applied) then v_status end
  );

  update rounds
  set
    name = case when 'name' = any (v_applied) then v_name else name end,
    round_date = case when 'round_date' = any (v_applied) then v_round_date else round_date end,
    format = case when 'format' = any (v_applied) then v_new_format else format end,
    bow_type = case when 'bow_type' = any (v_applied) then v_bow_type else bow_type end,
    status = case when 'status' = any (v_applied) then v_status else status end,
    revision = v_revision + 1
  where id = p_round_id;

  return jsonb_build_object(
    'revision', v_revision + 1, 'applied', true, 'applied_fields', to_jsonb(v_applied),
    'rejected_fields', v_rejected, 'reason', null::text
  );
end;
$_$;


ALTER FUNCTION "public"."update_round"("p_round_event_id" "uuid", "p_round_id" "uuid", "p_changes" "jsonb") OWNER TO "postgres";


CREATE CONSTRAINT TRIGGER "distances_capacity_guard" AFTER UPDATE OF "arrows_per_end", "total_ends" ON "public"."distances" NOT DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION "public"."distances_capacity_guard"();


CREATE OR REPLACE TRIGGER "set_distance_events_updated_at" BEFORE UPDATE ON "public"."distance_events" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


CREATE OR REPLACE TRIGGER "set_distances_updated_at" BEFORE UPDATE ON "public"."distances" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


CREATE OR REPLACE TRIGGER "set_round_events_updated_at" BEFORE UPDATE ON "public"."round_events" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


CREATE OR REPLACE TRIGGER "set_round_users_updated_at" BEFORE UPDATE ON "public"."round_users" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


CREATE OR REPLACE TRIGGER "set_rounds_updated_at" BEFORE UPDATE ON "public"."rounds" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


CREATE OR REPLACE TRIGGER "set_shot_events_updated_at" BEFORE UPDATE ON "public"."shot_events" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


CREATE OR REPLACE TRIGGER "set_shots_updated_at" BEFORE UPDATE ON "public"."shots" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


CREATE CONSTRAINT TRIGGER "shots_capacity_guard" AFTER INSERT OR UPDATE OF "disabled_at", "end_number", "distance_id" ON "public"."shots" NOT DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW WHEN (("new"."disabled_at" IS NULL)) EXECUTE FUNCTION "public"."shots_capacity_guard"();


ALTER TABLE ONLY "public"."distance_events"
    ADD CONSTRAINT "distance_events_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id");


ALTER TABLE ONLY "public"."distances"
    ADD CONSTRAINT "distances_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."distances"
    ADD CONSTRAINT "distances_target_face_id_fkey" FOREIGN KEY ("target_face_id") REFERENCES "public"."target_faces"("id");


ALTER TABLE ONLY "public"."round_events"
    ADD CONSTRAINT "round_events_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id");


ALTER TABLE ONLY "public"."round_users"
    ADD CONSTRAINT "round_users_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


ALTER TABLE ONLY "public"."round_users"
    ADD CONSTRAINT "round_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."shot_events"
    ADD CONSTRAINT "shot_events_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id");


ALTER TABLE ONLY "public"."shot_events"
    ADD CONSTRAINT "shot_events_shooter_id_fkey" FOREIGN KEY ("shooter_id") REFERENCES "public"."users"("id");


ALTER TABLE ONLY "public"."shots"
    ADD CONSTRAINT "shots_distance_id_fkey" FOREIGN KEY ("distance_id") REFERENCES "public"."distances"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."shots"
    ADD CONSTRAINT "shots_shooter_id_fkey" FOREIGN KEY ("shooter_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;


ALTER TABLE "public"."distance_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."distances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."round_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."round_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rounds" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "select_if_member" ON "public"."distance_events" FOR SELECT TO "authenticated" USING ("public"."is_round_member"("round_id"));


CREATE POLICY "select_if_member" ON "public"."distances" FOR SELECT TO "authenticated" USING ("public"."is_round_member"("round_id"));


CREATE POLICY "select_if_member" ON "public"."round_events" FOR SELECT TO "authenticated" USING ("public"."is_round_member"("round_id"));


CREATE POLICY "select_if_member" ON "public"."round_users" FOR SELECT TO "authenticated" USING ("public"."is_round_member"("round_id"));


CREATE POLICY "select_if_member" ON "public"."rounds" FOR SELECT TO "authenticated" USING ("public"."is_round_member"("id"));


CREATE POLICY "select_if_member" ON "public"."shot_events" FOR SELECT TO "authenticated" USING ("public"."is_round_member"(( SELECT "d"."round_id"
   FROM "public"."distances" "d"
  WHERE ("d"."id" = "shot_events"."distance_id"))));


CREATE POLICY "select_if_member" ON "public"."shots" FOR SELECT TO "authenticated" USING ("public"."is_round_member"(( SELECT "d"."round_id"
   FROM "public"."distances" "d"
  WHERE ("d"."id" = "shots"."distance_id"))));


ALTER TABLE "public"."shot_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shots" ENABLE ROW LEVEL SECURITY;


REVOKE EXECUTE ON FUNCTION "public"."create_round"("p_round_event_id" "uuid", "p_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."create_round"("p_round_event_id" "uuid", "p_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") TO "authenticated";


REVOKE EXECUTE ON FUNCTION "public"."update_round"("p_round_event_id" "uuid", "p_round_id" "uuid", "p_changes" "jsonb") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."update_round"("p_round_event_id" "uuid", "p_round_id" "uuid", "p_changes" "jsonb") TO "authenticated";


REVOKE EXECUTE ON FUNCTION "public"."disable_round"("p_round_event_id" "uuid", "p_round_id" "uuid") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."disable_round"("p_round_event_id" "uuid", "p_round_id" "uuid") TO "authenticated";


REVOKE EXECUTE ON FUNCTION "public"."create_distance"("p_distance_event_id" "uuid", "p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."create_distance"("p_distance_event_id" "uuid", "p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) TO "authenticated";


REVOKE EXECUTE ON FUNCTION "public"."update_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid", "p_changes" "jsonb") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."update_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid", "p_changes" "jsonb") TO "authenticated";


REVOKE EXECUTE ON FUNCTION "public"."disable_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."disable_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid") TO "authenticated";


REVOKE EXECUTE ON FUNCTION "public"."record_shots"("p_shots" "jsonb") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."record_shots"("p_shots" "jsonb") TO "authenticated";


REVOKE EXECUTE ON FUNCTION "public"."clear_shots"("p_shots" "jsonb") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."clear_shots"("p_shots" "jsonb") TO "authenticated";


REVOKE EXECUTE ON FUNCTION "public"."is_round_member"("target_round_id" "uuid") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."is_round_member"("target_round_id" "uuid") TO "authenticated";


REVOKE EXECUTE ON FUNCTION "public"."is_round_editor"("target_round_id" "uuid") FROM PUBLIC, "anon", "authenticated";


REVOKE EXECUTE ON FUNCTION "public"."shot_fits"("p_target_face_id" "uuid", "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_end" bigint, "p_shot_number" bigint, "p_score_str" "text", "p_score_int" bigint) FROM PUBLIC, "anon", "authenticated";


REVOKE EXECUTE ON FUNCTION "public"."shots_capacity_guard"() FROM PUBLIC, "anon", "authenticated";


REVOKE EXECUTE ON FUNCTION "public"."distances_capacity_guard"() FROM PUBLIC, "anon", "authenticated";


GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."distance_events" TO "service_role";


GRANT SELECT ON TABLE "public"."distance_events" TO "authenticated";


GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."distances" TO "service_role";


GRANT SELECT ON TABLE "public"."distances" TO "authenticated";


GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."round_events" TO "service_role";


GRANT SELECT ON TABLE "public"."round_events" TO "authenticated";


GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."round_users" TO "service_role";


GRANT SELECT ON TABLE "public"."round_users" TO "authenticated";


GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."rounds" TO "service_role";


GRANT SELECT ON TABLE "public"."rounds" TO "authenticated";


GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."shot_events" TO "service_role";


GRANT SELECT ON TABLE "public"."shot_events" TO "authenticated";


GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."shots" TO "service_role";


GRANT SELECT ON TABLE "public"."shots" TO "authenticated";

commit;
