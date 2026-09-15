begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- issue460: rounds/distances/shotsへの変更を追記専用のイベントログ
-- （round_events/distance_events/shot_events）として保存し、既存テーブルは
-- 「現在状態の射影」として同一トランザクションで同期更新する。
-- event_idはクライアント生成UUID（冪等性キー）、revisionはサーバー確定の
-- 対象ごとの通し番号（issue459で確立した「親行をfor updateでロックしてから
-- 検証・更新する」直列化境界の中で採番する）。
-- 無効化・取消はDELETEではなくdisabled_atによる論理削除として射影する。
-- disabled_atはRLSのSELECTポリシーには含めない（可視性はメンバーシップのみで
-- 判定し、射影としての「現在有効か」はアプリのクエリ側の関心とする。
-- docs/security.mdの認可マトリクスにdisabled_atの言及が無いことと整合させる）。

ALTER TABLE "public"."rounds"
  ADD COLUMN "revision" bigint NOT NULL DEFAULT 1 CHECK ("revision" >= 1),
  ADD COLUMN "disabled_at" timestamp with time zone;

ALTER TABLE "public"."distances"
  ADD COLUMN "revision" bigint NOT NULL DEFAULT 1 CHECK ("revision" >= 1),
  ADD COLUMN "disabled_at" timestamp with time zone;

ALTER TABLE "public"."shots"
  ADD COLUMN "revision" bigint NOT NULL DEFAULT 1 CHECK ("revision" >= 1),
  ADD COLUMN "disabled_at" timestamp with time zone;


CREATE TABLE "public"."round_events" (
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
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "round_events_type_check" CHECK (("type" = ANY (ARRAY['CREATED'::"text", 'UPDATED'::"text", 'DISABLED'::"text"]))),
    CONSTRAINT "round_events_revision_positive" CHECK (("revision" >= 1)),
    CONSTRAINT "round_events_payload_by_type" CHECK (
      ("type" = 'DISABLED' AND "name" IS NULL AND "round_date" IS NULL AND "format" IS NULL AND "bow_type" IS NULL)
      OR ("type" <> 'DISABLED' AND "name" IS NOT NULL AND "round_date" IS NOT NULL AND "format" IS NOT NULL AND "bow_type" IS NOT NULL)
    ),
    CONSTRAINT "round_events_round_id_revision_key" UNIQUE ("round_id", "revision")
);

ALTER TABLE ONLY "public"."round_events"
  ADD CONSTRAINT "round_events_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id");

ALTER TABLE "public"."round_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_if_member" ON "public"."round_events" FOR SELECT TO "authenticated" USING ("public"."is_round_member"("round_id"));

CREATE OR REPLACE TRIGGER "set_round_events_updated_at" BEFORE UPDATE ON "public"."round_events" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- INSERT/UPDATE/DELETEもGRANTは維持し（rounds/distances/shots等と同じ規約）、
-- ポリシーを一切定義しないことでRLSにより拒否する（permission deniedではなく
-- row-level securityエラーになる）。実際の追記はSECURITY DEFINER RPC経由のみ。
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."round_events" TO "authenticated";


CREATE TABLE "public"."distance_events" (
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
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "distance_events_type_check" CHECK (("type" = ANY (ARRAY['CREATED'::"text", 'UPDATED'::"text", 'DISABLED'::"text"]))),
    CONSTRAINT "distance_events_revision_positive" CHECK (("revision" >= 1)),
    CONSTRAINT "distance_events_payload_by_type" CHECK (
      ("type" = 'DISABLED' AND "position_key" IS NULL AND "distance" IS NULL AND "is_marked" IS NULL AND "total_ends" IS NULL AND "arrows_per_end" IS NULL AND "target_face_id" IS NULL)
      OR ("type" <> 'DISABLED' AND "position_key" IS NOT NULL AND "is_marked" IS NOT NULL AND "total_ends" IS NOT NULL AND "arrows_per_end" IS NOT NULL AND "target_face_id" IS NOT NULL AND (("is_marked" = false) OR ("distance" IS NOT NULL)))
    ),
    CONSTRAINT "distance_events_distance_id_revision_key" UNIQUE ("distance_id", "revision")
);

ALTER TABLE ONLY "public"."distance_events"
  ADD CONSTRAINT "distance_events_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id");

ALTER TABLE "public"."distance_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_if_member" ON "public"."distance_events" FOR SELECT TO "authenticated" USING ("public"."is_round_member"("round_id"));

CREATE OR REPLACE TRIGGER "set_distance_events_updated_at" BEFORE UPDATE ON "public"."distance_events" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."distance_events" TO "authenticated";


CREATE TABLE "public"."shot_events" (
    "event_id" "uuid" PRIMARY KEY,
    "distance_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "revision" bigint NOT NULL,
    "end_number" bigint NOT NULL,
    "arrow_number" bigint NOT NULL,
    "shooter_id" "uuid",
    "score_str" "text",
    "score_int" bigint,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shot_events_type_check" CHECK (("type" = ANY (ARRAY['RECORDED'::"text", 'CLEARED'::"text"]))),
    CONSTRAINT "shot_events_revision_positive" CHECK (("revision" >= 1)),
    CONSTRAINT "shot_events_payload_by_type" CHECK (
      ("type" = 'RECORDED' AND "shooter_id" IS NOT NULL AND "score_str" IS NOT NULL AND "score_int" IS NOT NULL)
      OR ("type" = 'CLEARED' AND "shooter_id" IS NULL AND "score_str" IS NULL AND "score_int" IS NULL)
    ),
    CONSTRAINT "shot_events_distance_id_end_number_arrow_number_revision_key" UNIQUE ("distance_id", "end_number", "arrow_number", "revision")
);

ALTER TABLE ONLY "public"."shot_events"
  ADD CONSTRAINT "shot_events_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id");

ALTER TABLE ONLY "public"."shot_events"
  ADD CONSTRAINT "shot_events_shooter_id_fkey" FOREIGN KEY ("shooter_id") REFERENCES "public"."users"("id");

ALTER TABLE "public"."shot_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_if_member" ON "public"."shot_events" FOR SELECT TO "authenticated" USING (
  "public"."is_round_member"((SELECT "d"."round_id" FROM "public"."distances" "d" WHERE "d"."id" = "shot_events"."distance_id"))
);

CREATE OR REPLACE TRIGGER "set_shot_events_updated_at" BEFORE UPDATE ON "public"."shot_events" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."shot_events" TO "authenticated";


-- ============================================================
-- 書き込みRPC本体をイベント追記+射影更新に置き換える
-- ============================================================
-- 外部契約（RPC名・引数の意味）はissue459で確定済みの境界を維持し、
-- 対象別イベントIDを新たに追加する（record_shots/clear_shotsは要素ごとの
-- shot_event_idをp_shotsのjsonb配列内に持たせるため、シグネチャ自体は不変）。

DROP FUNCTION "public"."create_round"("p_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb");

CREATE FUNCTION "public"."create_round"("p_round_event_id" "uuid", "p_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_round_id uuid := p_id;
  v_distance jsonb;
begin
  if exists (
    select 1 from jsonb_array_elements(p_distances) as distance_input
    where jsonb_typeof(distance_input -> 'is_marked') is distinct from 'boolean'
  ) then
    raise exception '初期距離のis_markedは必須です。';
  end if;

  if p_format <> 'field' and exists (
    select 1 from jsonb_array_elements(p_distances) as distance_input
    where (distance_input ->> 'is_marked')::boolean = false
  ) then
    raise exception 'Unmarkedの距離はフィールド種別でのみ使用できます。';
  end if;

  insert into round_events (event_id, round_id, type, author_id, revision, name, round_date, format, bow_type)
  values (p_round_event_id, v_round_id, 'CREATED', auth.uid(), 1, p_name, p_round_date, p_format, p_bow_type)
  on conflict (event_id) do nothing;

  if not found then
    select round_id into v_round_id from round_events where event_id = p_round_event_id;
    return v_round_id;
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

  return v_round_id;
end;
$$;

ALTER FUNCTION "public"."create_round"("p_round_event_id" "uuid", "p_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") OWNER TO "postgres";


DROP FUNCTION "public"."update_round"("p_round_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text");

CREATE FUNCTION "public"."update_round"("p_round_event_id" "uuid", "p_round_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_revision bigint;
begin
  -- 距離の追加・更新も同じ親行を先にロックする。formatとis_markedの組合せを
  -- 検証してから更新する間に、別の編集者がUnmarked距離を追加・変更できない。
  select revision into v_revision
  from rounds
  where id = p_round_id
  for update;

  if v_revision is null or not is_round_editor(p_round_id) then
    raise exception 'このラウンドを編集する権限がありません。';
  end if;

  if p_format <> 'field' and exists (
    select 1 from distances
    where round_id = p_round_id and is_marked = false and disabled_at is null
  ) then
    raise exception 'Unmarkedの距離が残っているため、フィールド以外の種別には変更できません。先に各距離をMarkedに変更してください。';
  end if;

  insert into round_events (event_id, round_id, type, author_id, revision, name, round_date, format, bow_type)
  values (p_round_event_id, p_round_id, 'UPDATED', auth.uid(), v_revision + 1, p_name, p_round_date, p_format, p_bow_type)
  on conflict (event_id) do nothing;

  if not found then
    return;
  end if;

  update rounds
  set name = p_name, round_date = p_round_date, format = p_format, bow_type = p_bow_type, revision = v_revision + 1
  where id = p_round_id;
end;
$$;

ALTER FUNCTION "public"."update_round"("p_round_event_id" "uuid", "p_round_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text") OWNER TO "postgres";


DROP FUNCTION "public"."create_distance"("p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean);

CREATE FUNCTION "public"."create_distance"("p_distance_event_id" "uuid", "p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_format text;
begin
  -- update_round/update_distanceと同じ親行をロックしてからformatを読む。
  -- これにより、フィールド以外への変更とUnmarked距離の追加が同時に
  -- 通過することを防ぐ。
  select format into v_format
  from rounds
  where id = p_round_id
  for update;

  if not is_round_editor(p_round_id) then
    raise exception 'このラウンドに距離を追加する権限がありません。';
  end if;

  if not p_is_marked and v_format <> 'field' then
    raise exception 'Unmarkedの距離はフィールド種別でのみ使用できます。';
  end if;

  insert into distance_events (
    event_id, round_id, distance_id, type, author_id, revision,
    position_key, distance, is_marked, total_ends, arrows_per_end, target_face_id
  )
  values (
    p_distance_event_id, p_round_id, p_id, 'CREATED', auth.uid(), 1,
    p_position_key, p_distance, p_is_marked, p_total_ends, p_arrows_per_end, p_target_face_id
  ) on conflict (event_id) do nothing;

  if not found then
    return;
  end if;

  insert into distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked, revision)
  values (p_id, p_round_id, p_position_key, p_distance, p_total_ends, p_arrows_per_end, p_target_face_id, p_is_marked, 1);
end;
$$;

ALTER FUNCTION "public"."create_distance"("p_distance_event_id" "uuid", "p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) OWNER TO "postgres";


DROP FUNCTION "public"."update_distance"("p_distance_id" "uuid", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean);

CREATE FUNCTION "public"."update_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_round_id uuid;
  v_format text;
  v_revision bigint;
  v_total_ends bigint;
  v_arrows_per_end bigint;
  v_target_face_id uuid;
  v_has_shots boolean;
begin
  select round_id into v_round_id
  from distances
  where id = p_distance_id;

  -- formatとis_markedの組合せを変える全RPCは親rounds行を先にロックする。
  -- create_distance/update_roundとの検証・更新を同じ直列化境界に置く。
  select format into v_format
  from rounds
  where id = v_round_id
  for update;

  -- 得点の記録・取消も同じdistance行をロックするため、構成変更と得点操作を
  -- 直列化する。得点の有無を読んだ直後に別トランザクションが得点を追加し、
  -- 的やエンド構成だけが後から変わる競合を防ぐ。
  select revision, total_ends, arrows_per_end, target_face_id
    into v_revision, v_total_ends, v_arrows_per_end, v_target_face_id
  from distances
  where id = p_distance_id
  for update;

  if v_round_id is null or not is_round_editor(v_round_id) then
    raise exception 'この距離を編集する権限がありません。';
  end if;

  if not p_is_marked and v_format <> 'field' then
    raise exception 'Unmarkedの距離はフィールド種別でのみ使用できます。';
  end if;

  select exists (
    select 1 from shots where distance_id = p_distance_id and disabled_at is null
  ) into v_has_shots;

  -- shotsが1件でも存在する距離は、総エンド数・エンドあたりの本数に加えて
  -- 的（target_face_id）も変更させない。的の種類が変わると点数の意味も
  -- 変わってしまい、既に記録済みのshotsと整合しなくなるため（UI側でも
  -- 読み取り専用にしているが、ここでも防御的に無視する）。distance・
  -- is_markedは点数構成に関係しないメタ情報なので、shots有無にかかわらず
  -- 常に変更できる。構成列が違う要求は無言で捨てず、呼び出し側が再読込・
  -- 再入力できるよう明示的に失敗させる。この検証により、shots有無に関わらず
  -- 渡された値をそのまま射影へ反映してよい（一致していることが保証される）。
  if v_has_shots
    and (p_total_ends is distinct from v_total_ends
      or p_arrows_per_end is distinct from v_arrows_per_end
      or p_target_face_id is distinct from v_target_face_id) then
    raise exception '既に得点が記録されているため、エンド数・矢数・的は変更できません。';
  end if;

  insert into distance_events (
    event_id, round_id, distance_id, type, author_id, revision,
    position_key, distance, is_marked, total_ends, arrows_per_end, target_face_id
  )
  select p_distance_event_id, v_round_id, p_distance_id, 'UPDATED', auth.uid(), v_revision + 1,
    position_key, p_distance, p_is_marked, p_total_ends, p_arrows_per_end, p_target_face_id
  from distances where id = p_distance_id
  on conflict (event_id) do nothing;

  if not found then
    return;
  end if;

  update distances
  set
    distance = p_distance,
    total_ends = p_total_ends,
    arrows_per_end = p_arrows_per_end,
    target_face_id = p_target_face_id,
    is_marked = p_is_marked,
    revision = v_revision + 1
  where id = p_distance_id;
end;
$$;

ALTER FUNCTION "public"."update_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) OWNER TO "postgres";


DROP FUNCTION "public"."delete_round"("p_round_id" "uuid");

CREATE FUNCTION "public"."disable_round"("p_round_event_id" "uuid", "p_round_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_revision bigint;
begin
  select revision into v_revision
  from rounds
  where id = p_round_id
  for update;

  if v_revision is null or not is_round_editor(p_round_id) then
    raise exception 'このラウンドを削除する権限がありません。';
  end if;

  insert into round_events (event_id, round_id, type, author_id, revision)
  values (p_round_event_id, p_round_id, 'DISABLED', auth.uid(), v_revision + 1)
  on conflict (event_id) do nothing;

  if not found then
    return;
  end if;

  update rounds
  set disabled_at = coalesce(disabled_at, clock_timestamp()), revision = v_revision + 1
  where id = p_round_id;
end;
$$;

ALTER FUNCTION "public"."disable_round"("p_round_event_id" "uuid", "p_round_id" "uuid") OWNER TO "postgres";


DROP FUNCTION "public"."delete_distance"("p_distance_id" "uuid");

CREATE FUNCTION "public"."disable_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_round_id uuid;
  v_revision bigint;
begin
  select round_id into v_round_id from distances where id = p_distance_id;

  select revision into v_revision
  from distances
  where id = p_distance_id
  for update;

  if v_round_id is null or not is_round_editor(v_round_id) then
    raise exception 'この距離を削除する権限がありません。';
  end if;

  insert into distance_events (event_id, round_id, distance_id, type, author_id, revision)
  values (p_distance_event_id, v_round_id, p_distance_id, 'DISABLED', auth.uid(), v_revision + 1)
  on conflict (event_id) do nothing;

  if not found then
    return;
  end if;

  update distances
  set disabled_at = coalesce(disabled_at, clock_timestamp()), revision = v_revision + 1
  where id = p_distance_id;
end;
$$;

ALTER FUNCTION "public"."disable_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_shots"("p_shots" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_shot jsonb;
  v_distance_id uuid;
  v_round_id uuid;
  v_shooter_id uuid;
  v_current_revision bigint;
begin
  -- バッチ内のdistanceをID順にロックする。同じ複数distanceを逆順で処理する
  -- 別クライアントともロック順が一致するため、デッドロックを避けられる。
  for v_distance_id in
    select distinct (shot ->> 'distance_id')::uuid
    from jsonb_array_elements(p_shots) as shot
    order by 1
  loop
    select d.round_id into v_round_id
    from distances d
    where d.id = v_distance_id
    for update;

    if v_round_id is null or not is_round_editor(v_round_id) then
      raise exception 'この距離に矢を記録する権限がありません。';
    end if;

  end loop;

  for v_shot in select * from jsonb_array_elements(p_shots)
  loop
    v_distance_id := (v_shot ->> 'distance_id')::uuid;

    select d.round_id into v_round_id from distances d where d.id = v_distance_id;

    if v_round_id is null or not is_round_editor(v_round_id) then
      raise exception 'この距離に矢を記録する権限がありません。';
    end if;

    -- shooter_idは省略時のみ実行者本人（auth.uid()）を使う。省略しない場合も
    -- 「誰の代理で記録するか」を選ぶだけであり、権限自体は上のis_round_editor()
    -- （実行者=auth.uid()がそのラウンドのeditorか）で判定済みなので、
    -- author_idに相当する実行者情報がクライアント入力に左右されることはない。
    v_shooter_id := coalesce((v_shot ->> 'shooter_id')::uuid, auth.uid());

    if not exists (
      select 1 from round_users
      where round_id = v_round_id and user_id = v_shooter_id
    ) then
      raise exception '指定された射手はこのラウンドのメンバーではありません。';
    end if;

    select max(revision) into v_current_revision
    from shot_events
    where distance_id = v_distance_id
      and end_number = (v_shot ->> 'end_number')::bigint
      and arrow_number = (v_shot ->> 'arrow_number')::bigint;

    insert into shot_events (
      event_id, distance_id, type, author_id, revision, end_number, arrow_number, shooter_id, score_str, score_int
    )
    values (
      (v_shot ->> 'shot_event_id')::uuid, v_distance_id, 'RECORDED', auth.uid(), coalesce(v_current_revision, 0) + 1,
      (v_shot ->> 'end_number')::bigint, (v_shot ->> 'arrow_number')::bigint,
      v_shooter_id, v_shot ->> 'score_str', (v_shot ->> 'score_int')::bigint
    ) on conflict (event_id) do nothing;

    if not found then
      continue;
    end if;

    insert into shots (distance_id, end_number, arrow_number, shooter_id, score_str, score_int, revision)
    values (
      v_distance_id,
      (v_shot ->> 'end_number')::bigint,
      (v_shot ->> 'arrow_number')::bigint,
      v_shooter_id,
      v_shot ->> 'score_str',
      (v_shot ->> 'score_int')::bigint,
      coalesce(v_current_revision, 0) + 1
    )
    on conflict (distance_id, end_number, arrow_number)
    do update set
      shooter_id = excluded.shooter_id,
      score_str = excluded.score_str,
      score_int = excluded.score_int,
      revision = excluded.revision,
      disabled_at = null;
  end loop;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."clear_shots"("p_shots" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_shot jsonb;
  v_distance_id uuid;
  v_round_id uuid;
  v_current_revision bigint;
begin
  -- record_shotsと同じ順序でdistanceをロックし、得点の記録・取消と距離構成
  -- の変更を同じ直列化境界に置く。
  for v_distance_id in
    select distinct (shot ->> 'distance_id')::uuid
    from jsonb_array_elements(p_shots) as shot
    order by 1
  loop
    select d.round_id into v_round_id
    from distances d
    where d.id = v_distance_id
    for update;

    if v_round_id is null or not is_round_editor(v_round_id) then
      raise exception 'この距離の矢を取り消す権限がありません。';
    end if;

  end loop;

  for v_shot in select * from jsonb_array_elements(p_shots)
  loop
    v_distance_id := (v_shot ->> 'distance_id')::uuid;

    select d.round_id into v_round_id from distances d where d.id = v_distance_id;

    if v_round_id is null or not is_round_editor(v_round_id) then
      raise exception 'この距離の矢を取り消す権限がありません。';
    end if;

    select max(revision) into v_current_revision
    from shot_events
    where distance_id = v_distance_id
      and end_number = (v_shot ->> 'end_number')::bigint
      and arrow_number = (v_shot ->> 'arrow_number')::bigint;

    insert into shot_events (event_id, distance_id, type, author_id, revision, end_number, arrow_number)
    values (
      (v_shot ->> 'shot_event_id')::uuid, v_distance_id, 'CLEARED', auth.uid(), coalesce(v_current_revision, 0) + 1,
      (v_shot ->> 'end_number')::bigint, (v_shot ->> 'arrow_number')::bigint
    ) on conflict (event_id) do nothing;

    if not found then
      continue;
    end if;

    update shots
    set disabled_at = clock_timestamp(), revision = coalesce(v_current_revision, 0) + 1
    where distance_id = v_distance_id
      and end_number = (v_shot ->> 'end_number')::bigint
      and arrow_number = (v_shot ->> 'arrow_number')::bigint;
  end loop;
end;
$$;


-- save_round_as_presetは無効化済みの距離をプリセットへ含めない。
CREATE OR REPLACE FUNCTION "public"."save_round_as_preset"("p_round_id" "uuid", "p_name" "text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_format text;
  v_bow_type text;
  v_preset_id uuid;
begin
  select format, bow_type into v_format, v_bow_type
  from rounds
  where id = p_round_id and disabled_at is null;

  if not found then
    raise exception 'ラウンドの取得に失敗しました。';
  end if;

  insert into preset_rounds (owner_id, name, format, bow_type)
  values (auth.uid(), p_name, v_format, v_bow_type)
  returning id into v_preset_id;

  insert into preset_distances (
    preset_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked
  )
  select v_preset_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked
  from distances
  where round_id = p_round_id and disabled_at is null
  order by position_key, id;

  return v_preset_id;
end;
$$;


-- ============================================================
-- 実行権限
-- ============================================================
-- シグネチャが変わった関数（record_shots/clear_shotsを除く）は
-- CREATE時にPUBLICへEXECUTEが既定付与されるため、明示的に剥奪してから
-- authenticatedだけへ付与し直す。

REVOKE EXECUTE ON FUNCTION "public"."create_round"("p_round_event_id" "uuid", "p_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."update_round"("p_round_event_id" "uuid", "p_round_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."create_distance"("p_distance_event_id" "uuid", "p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."update_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."disable_round"("p_round_event_id" "uuid", "p_round_id" "uuid") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."disable_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid") FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."create_round"("p_round_event_id" "uuid", "p_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."update_round"("p_round_event_id" "uuid", "p_round_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."create_distance"("p_distance_event_id" "uuid", "p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."update_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."disable_round"("p_round_event_id" "uuid", "p_round_id" "uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."disable_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid") TO "authenticated";

commit;
