-- 記録のデータが無く旧版との互換も持たないため、行の検査の待ち、必須の列の追加、列の削除、NOT NULLの解除を許す。射手の番号の型はintegerである。
-- squawk-ignore-file constraint-missing-not-valid, adding-foreign-key-constraint, adding-required-field, ban-drop-column, ban-drop-not-null, prefer-bigint-over-int
begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- 参加者と射手。有効な行は、射つ人(利用者、owner、番号)、代理の人(利用者、editor、番号なし)、利用者に紐づかない射手(番号だけ)である。
ALTER TABLE "public"."round_users" DROP CONSTRAINT "round_users_role_check";
ALTER TABLE "public"."round_users" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "public"."round_users" ALTER COLUMN "role" DROP NOT NULL;
ALTER TABLE "public"."round_users" ADD COLUMN "shooter_number" integer;

ALTER TABLE "public"."round_users"
    ADD CONSTRAINT "round_users_role_check" CHECK ("role" IN ('owner', 'editor')),
    ADD CONSTRAINT "round_users_owner_has_number" CHECK ("role" IS DISTINCT FROM 'owner' OR "shooter_number" IS NOT NULL),
    ADD CONSTRAINT "round_users_shooter_number_positive" CHECK ("shooter_number" > 0),
    ADD CONSTRAINT "round_users_role_has_user" CHECK ("role" IS NULL OR "user_id" IS NOT NULL),
    ADD CONSTRAINT "round_users_user_has_role" CHECK ("user_id" IS NULL OR "role" IS NOT NULL),
    ADD CONSTRAINT "round_users_unlinked_is_shooter" CHECK ("user_id" IS NOT NULL OR ("role" IS NULL AND "shooter_number" IS NOT NULL)),
    ADD CONSTRAINT "round_users_numbered_user_is_owner" CHECK ("user_id" IS NULL OR "shooter_number" IS NULL OR "role" IS NOT DISTINCT FROM 'owner'),
    ADD CONSTRAINT "round_users_user_not_deleted_user" CHECK ("user_id" IS DISTINCT FROM '00000000-0000-4000-8000-000000000001'::uuid);

-- squawk-ignore disallowed-unique-constraint
ALTER TABLE "public"."round_users" ADD CONSTRAINT "round_users_round_id_shooter_number_key" UNIQUE ("round_id", "shooter_number");

-- 利用者の削除は参加を連鎖して消さない。削除の処理が、先に紐づけと参加を外す。
ALTER TABLE "public"."round_users" DROP CONSTRAINT "round_users_user_id_fkey";
ALTER TABLE "public"."round_users"
    ADD CONSTRAINT "round_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");

-- squawk-ignore disallowed-unique-constraint
ALTER TABLE "public"."distances" ADD CONSTRAINT "distances_round_id_id_key" UNIQUE ("round_id", "id");

-- 矢と矢の変更履歴。射手を番号で指し、距離と射手を同じラウンドに限る。
ALTER TABLE "public"."shots" DROP COLUMN "shooter_id";
ALTER TABLE "public"."shots" ADD COLUMN "round_id" uuid NOT NULL;
ALTER TABLE "public"."shots" ADD COLUMN "shooter_number" integer NOT NULL;
ALTER TABLE "public"."shots" DROP CONSTRAINT "shots_distance_id_fkey";
ALTER TABLE "public"."shots"
    ADD CONSTRAINT "shots_round_id_distance_id_fkey" FOREIGN KEY ("round_id", "distance_id")
        REFERENCES "public"."distances"("round_id", "id") ON DELETE CASCADE,
    ADD CONSTRAINT "shots_round_id_shooter_number_fkey" FOREIGN KEY ("round_id", "shooter_number")
        REFERENCES "public"."round_users"("round_id", "shooter_number");
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX "shots_round_id_shooter_number_idx" ON "public"."shots" USING "btree" ("round_id", "shooter_number");

ALTER TABLE "public"."shot_events" DROP COLUMN "shooter_id";
ALTER TABLE "public"."shot_events" ADD COLUMN "round_id" uuid NOT NULL;
ALTER TABLE "public"."shot_events" ADD COLUMN "shooter_number" integer NOT NULL;
ALTER TABLE "public"."shot_events"
    ADD CONSTRAINT "shot_events_round_id_distance_id_fkey" FOREIGN KEY ("round_id", "distance_id")
        REFERENCES "public"."distances"("round_id", "id"),
    ADD CONSTRAINT "shot_events_round_id_shooter_number_fkey" FOREIGN KEY ("round_id", "shooter_number")
        REFERENCES "public"."round_users"("round_id", "shooter_number");
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX "shot_events_round_id_shooter_number_idx" ON "public"."shot_events" USING "btree" ("round_id", "shooter_number");

-- 一度付いた射手の番号と、射手の行のラウンドは変えない。紐づく利用者は変えられる。
CREATE FUNCTION "public"."keep_shooter_number"() RETURNS trigger
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if old.shooter_number is not null
    and (new.shooter_number is distinct from old.shooter_number or new.round_id is distinct from old.round_id) then
    raise exception '射手の番号とラウンドは変更できません。' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."keep_shooter_number"() OWNER TO "postgres";
REVOKE EXECUTE ON FUNCTION "public"."keep_shooter_number"() FROM PUBLIC, "anon", "authenticated";

CREATE TRIGGER "keep_round_users_shooter_number" BEFORE UPDATE ON "public"."round_users"
    FOR EACH ROW EXECUTE FUNCTION "public"."keep_shooter_number"();

-- 残るラウンドには射つ人が1人以上いる。コミットの時点で検査する。
-- コミットの時点の実行者の行単位のアクセス制御を受けないよう、SECURITY DEFINERにする。
CREATE FUNCTION "public"."require_round_owner"() RETURNS trigger
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_round_ids uuid[];
begin
  if tg_table_name = 'rounds' then
    v_round_ids := array[new.id];
  elsif tg_op = 'INSERT' then
    v_round_ids := array[new.round_id];
  elsif tg_op = 'DELETE' then
    v_round_ids := array[old.round_id];
  else
    v_round_ids := array[old.round_id, new.round_id];
  end if;

  -- 同じトランザクションで物理削除したラウンドは、roundsに行が無いため対象にならない。
  if exists (
    select 1 from public.rounds r
    where r.id = any (v_round_ids)
      and not exists (select 1 from public.round_users ru where ru.round_id = r.id and ru.role = 'owner')
  ) then
    raise exception 'ラウンドには射つ人が1人以上必要です。' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

ALTER FUNCTION "public"."require_round_owner"() OWNER TO "postgres";
REVOKE EXECUTE ON FUNCTION "public"."require_round_owner"() FROM PUBLIC, "anon", "authenticated";

CREATE CONSTRAINT TRIGGER "require_rounds_owner" AFTER INSERT ON "public"."rounds"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."require_round_owner"();
CREATE CONSTRAINT TRIGGER "require_round_users_owner" AFTER INSERT OR UPDATE OR DELETE ON "public"."round_users"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."require_round_owner"();

-- 認可と閲覧。参加は、本人の利用者と役割がある行があることである。
CREATE OR REPLACE FUNCTION "public"."is_round_editor"("target_round_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from round_users ru
    where ru.round_id = target_round_id and ru.user_id = auth.uid() and ru.role in ('owner', 'editor')
  );
$$;

CREATE OR REPLACE FUNCTION "public"."is_round_member"("target_round_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from round_users ru
    where ru.round_id = target_round_id and ru.user_id = auth.uid() and ru.role in ('owner', 'editor')
  );
$$;

CREATE FUNCTION "public"."member_round_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT ru.round_id
  FROM public.round_users ru
  WHERE ru.user_id = auth.uid()
    AND ru.role IN ('owner', 'editor');
$$;

ALTER FUNCTION "public"."member_round_ids"() OWNER TO "postgres";
REVOKE EXECUTE ON FUNCTION "public"."member_round_ids"() FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."member_round_ids"() TO "authenticated";

ALTER POLICY "select_if_member" ON "public"."shots"
    USING ("round_id" IN (SELECT "public"."member_round_ids"()));
ALTER POLICY "select_if_member" ON "public"."shot_events"
    USING ("round_id" IN (SELECT "public"."member_round_ids"()));

-- 書き込み。操作者の利用者の行、ラウンド、距離の順にロックし、同じ種類の複数の行はID順にする。
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
  perform 1 from users where id = auth.uid() for key share;

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

  insert into round_users (round_id, user_id, role, shooter_number)
  values (v_round_id, auth.uid(), 'owner', 1);

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
  perform 1 from users where id = auth.uid() for key share;

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

CREATE OR REPLACE FUNCTION "public"."disable_round"("p_round_event_id" "uuid", "p_round_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_revision bigint;
  v_disabled_at timestamptz;
  v_event_revision bigint;
begin
  perform 1 from users where id = auth.uid() for key share;

  select revision, disabled_at into v_revision, v_disabled_at
  from rounds
  where id = p_round_id
  for update;

  -- 削除できるのは、射つ人が自分1人のときの本人だけである。
  if v_revision is null
    or not exists (
      select 1 from round_users
      where round_id = p_round_id and user_id = auth.uid() and role = 'owner'
    )
    or (select count(*) from round_users where round_id = p_round_id and role = 'owner') <> 1 then
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

CREATE OR REPLACE FUNCTION "public"."create_distance"("p_distance_event_id" "uuid", "p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_format text;
  v_round_disabled_at timestamptz;
  v_event_revision bigint;
begin
  perform 1 from users where id = auth.uid() for key share;

  -- update_roundと競合する親行のロックを取ってからformatを読む。
  select format, disabled_at into v_format, v_round_disabled_at
  from rounds
  where id = p_round_id
  for share;

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
  -- 親のロックはFOR SHAREで、同じ操作の要求は並行する。上の照合の後に同じ操作が確定していれば、拒否せず記録した結果を返す。
  if exists (select 1 from distances where id = p_id) then
    select revision into v_event_revision from distance_events where event_id = p_distance_event_id;
    if found then
      return jsonb_build_object('revision', v_event_revision, 'applied', true, 'reason', null::text);
    end if;
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
  )
  on conflict (event_id) do nothing;

  -- 同じ操作の要求が未確定なら上の追加は確定を待ち、確定した場合は追加せず、記録した結果を返す。
  if not found then
    select revision into v_event_revision from distance_events where event_id = p_distance_event_id;
    return jsonb_build_object('revision', v_event_revision, 'applied', true, 'reason', null::text);
  end if;

  insert into distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked, revision)
  values (p_id, p_round_id, p_position_key, p_distance, p_total_ends, p_arrows_per_end, p_target_face_id, p_is_marked, 1);

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
  perform 1 from users where id = auth.uid() for key share;

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
  for share;

  -- 得点の記録・取消も同じdistance行をロックするため、構成の変更と矢の記録を直列化する。
  select revision, disabled_at, distance, is_marked, total_ends, arrows_per_end, target_face_id
    into v_revision, v_distance_disabled_at, v_distance, v_is_marked, v_total_ends, v_arrows_per_end, v_target_face_id
  from distances
  where id = p_distance_id
  for update;

  -- 親のロックを待つ間に、距離がラウンドごと削除されていないかを確かめる。
  if not found then
    return jsonb_build_object(
      'revision', null::bigint, 'applied', false, 'applied_fields', null::text[],
      'rejected_fields', '[]'::jsonb, 'reason', 'MISSING'
    );
  end if;

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
    -- 射数/エンドの上限は、各矢が新しい範囲のマスにあることで守る(マスごとに1行)。
    if exists (
      select 1 from shots s
      where s.distance_id = p_distance_id
        and s.disabled_at is null
        and not shot_fits(v_new_target_face_id, v_new_total_ends, v_new_arrows_per_end, s.end_number, s.shot_number, s.score_str, s.score_int)
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
  perform 1 from users where id = auth.uid() for key share;

  select round_id into v_round_id from distances where id = p_distance_id;

  if v_round_id is null then
    return jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'MISSING');
  end if;

  perform 1 from rounds where id = v_round_id for share;

  select revision, disabled_at into v_revision, v_distance_disabled_at
  from distances
  where id = p_distance_id
  for update;

  -- 親のロックを待つ間に、距離がラウンドごと削除されていないかを確かめる。
  if not found then
    return jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'MISSING');
  end if;

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

CREATE OR REPLACE FUNCTION public.record_shots(p_shots jsonb) returns jsonb
language plpgsql security definer
set search_path to 'public'
as $_$
declare
  v_shot jsonb;
  v_distance_id uuid;
  v_round_id uuid;
  v_round_disabled_at timestamptz;
  v_distance_disabled_at timestamptz;
  v_total_ends bigint;
  v_arrows_per_end bigint;
  v_target_face_id uuid;
  v_end bigint;
  v_shot_number bigint;
  v_score_str text;
  v_score_int bigint;
  v_shooter_value jsonb;
  v_shooter_numeric numeric;
  v_shooter_number integer;
  v_row_found boolean;
  v_applied text[];
  v_new_revision bigint;
  v_event_revision bigint;
  v_event_set_fields text[];
  v_results jsonb := '[]'::jsonb;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  -- 契約の検証。マス(end_number、shot_number)の無い要素と旧い形(shot_id)の要素は拒否する。
  if p_shots is null or jsonb_typeof(p_shots) <> 'array' or jsonb_array_length(p_shots) > 100 then
    raise exception '矢の記録は100件以下の配列で指定してください。' using errcode = 'PT422';
  end if;
  for v_shot in select * from jsonb_array_elements(p_shots)
  loop
    if jsonb_typeof(v_shot) <> 'object'
      or coalesce(jsonb_typeof(v_shot -> 'distance_id'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'shot_event_id'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'end_number'), '') <> 'number'
      or coalesce(jsonb_typeof(v_shot -> 'shot_number'), '') <> 'number'
      or coalesce(jsonb_typeof(v_shot -> 'score_str'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'score_int'), '') <> 'number'
      or coalesce((v_shot ->> 'distance_id') !~ v_uuid_re, true)
      or coalesce((v_shot ->> 'shot_event_id') !~ v_uuid_re, true)
      or coalesce((v_shot #>> '{end_number}') !~ '^[1-9][0-9]{0,15}$', true)
      or coalesce((v_shot #>> '{shot_number}') !~ '^[1-9][0-9]{0,15}$', true)
      or coalesce((v_shot #>> '{score_int}') !~ '^-?[0-9]{1,15}$', true)
      or (v_shot ->> 'score_str') = '' then
      raise exception '矢の記録の指定が不正です。' using errcode = 'PT422';
    end if;
    -- 射手の番号は、型を確かめてから数値にし、範囲と整数性を確かめた値だけをintegerにする。
    v_shooter_value := v_shot -> 'shooter_number';
    if v_shooter_value is null or jsonb_typeof(v_shooter_value) <> 'number' then
      raise exception '射手の番号が不正です。' using errcode = 'PT422';
    end if;
    v_shooter_numeric := (v_shooter_value #>> '{}')::numeric;
    if v_shooter_numeric < 1 or v_shooter_numeric > 2147483647 or v_shooter_numeric <> trunc(v_shooter_numeric) then
      raise exception '射手の番号が不正です。' using errcode = 'PT422';
    end if;
  end loop;

  perform 1 from users where id = auth.uid() for key share;

  perform 1 from rounds r
  where r.id in (
    select d.round_id
    from jsonb_array_elements(p_shots) as shot
    join distances d on d.id = (shot ->> 'distance_id')::uuid
  )
  order by r.id
  for share;

  -- バッチ内のdistanceをID順にロックする。
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
    v_end := (v_shot ->> 'end_number')::bigint;
    v_shot_number := (v_shot ->> 'shot_number')::bigint;
    v_score_str := v_shot ->> 'score_str';
    v_score_int := (v_shot ->> 'score_int')::bigint;
    v_shooter_number := (v_shot ->> 'shooter_number')::numeric::integer;

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
      v_applied := coalesce(v_event_set_fields, array['score', 'shooter_number']);
      v_results := v_results || jsonb_build_object(
        'revision', v_event_revision,
        'applied', true,
        'applied_fields', to_jsonb(v_applied),
        'rejected_fields', (
          select coalesce(jsonb_agg(jsonb_build_object('field', k, 'reason', 'REJECTED')), '[]'::jsonb)
          from unnest(array['score', 'shooter_number']) k
          where k <> all (v_applied)
        ),
        'reason', null::text
      );
      continue;
    end if;

    if v_round_disabled_at is not null or v_distance_disabled_at is not null then
      v_results := v_results || jsonb_build_object(
        'revision', null::bigint, 'applied', false, 'applied_fields', null::text[],
        'rejected_fields', '[]'::jsonb, 'reason', 'DISABLED'
      );
      continue;
    end if;

    -- 射手の指定は誰の矢にするかを選ぶだけで、権限は上のis_round_editor()で判定済みである。
    if not exists (
      select 1 from round_users ru
      where ru.round_id = v_round_id and ru.shooter_number = v_shooter_number
        and (ru.user_id is null or ru.role = 'owner')
    ) then
      raise exception '指定された射手はこのラウンドの射手ではありません。' using errcode = 'PT403';
    end if;

    -- 現在の構成に収まらないマス・点数は効かせない。射数/エンドの上限は、この範囲の判定と主キーで守る。
    if not shot_fits(v_target_face_id, v_total_ends, v_arrows_per_end, v_end, v_shot_number, v_score_str, v_score_int) then
      v_results := v_results || jsonb_build_object(
        'revision', null::bigint, 'applied', false, 'applied_fields', null::text[],
        'rejected_fields', '[]'::jsonb, 'reason', 'UNFIT'
      );
      continue;
    end if;

    v_row_found := exists (
      select 1 from shots
      where distance_id = v_distance_id and end_number = v_end and shot_number = v_shot_number
    );
    v_applied := array['score', 'shooter_number'];

    -- マスの履歴と射影の両方のrevisionを見て採番する。
    select greatest(
      (select max(e.revision) from shot_events e
        where e.distance_id = v_distance_id and e.end_number = v_end and e.shot_number = v_shot_number),
      (select s.revision from shots s
        where s.distance_id = v_distance_id and s.end_number = v_end and s.shot_number = v_shot_number),
      0
    ) + 1 into v_new_revision;

    insert into shot_events (
      event_id, round_id, distance_id, end_number, shot_number, type, author_id, revision,
      shooter_number, score_str, score_int, set_fields
    )
    values (
      (v_shot ->> 'shot_event_id')::uuid, v_round_id, v_distance_id, v_end, v_shot_number, 'RECORDED', auth.uid(),
      v_new_revision, v_shooter_number, v_score_str, v_score_int, v_applied
    );

    if v_row_found then
      update shots
      set
        score_str = v_score_str,
        score_int = v_score_int,
        shooter_number = v_shooter_number,
        revision = v_new_revision,
        disabled_at = null
      where distance_id = v_distance_id and end_number = v_end and shot_number = v_shot_number;
    else
      insert into shots (round_id, distance_id, end_number, shot_number, shooter_number, score_str, score_int, revision)
      values (v_round_id, v_distance_id, v_end, v_shot_number, v_shooter_number, v_score_str, v_score_int, v_new_revision);
    end if;

    v_results := v_results || jsonb_build_object(
      'revision', v_new_revision, 'applied', true, 'applied_fields', to_jsonb(v_applied),
      'rejected_fields', '[]'::jsonb, 'reason', null::text
    );
  end loop;

  return v_results;
end;
$_$;

CREATE OR REPLACE FUNCTION public.clear_shots(p_shots jsonb) returns jsonb
language plpgsql security definer
set search_path to 'public'
as $_$
declare
  v_shot jsonb;
  v_distance_id uuid;
  v_round_id uuid;
  v_round_disabled_at timestamptz;
  v_distance_disabled_at timestamptz;
  v_end bigint;
  v_shot_number bigint;
  v_row_disabled_at timestamptz;
  v_shooter_number integer;
  v_new_revision bigint;
  v_event_revision bigint;
  v_results jsonb := '[]'::jsonb;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  -- 契約の検証。マス(end_number、shot_number)の無い要素と旧い形(shot_id)の要素は拒否する。
  if p_shots is null or jsonb_typeof(p_shots) <> 'array' or jsonb_array_length(p_shots) > 100 then
    raise exception '矢の取り消しは100件以下の配列で指定してください。' using errcode = 'PT422';
  end if;
  for v_shot in select * from jsonb_array_elements(p_shots)
  loop
    if jsonb_typeof(v_shot) <> 'object'
      or coalesce(jsonb_typeof(v_shot -> 'distance_id'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'shot_event_id'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'end_number'), '') <> 'number'
      or coalesce(jsonb_typeof(v_shot -> 'shot_number'), '') <> 'number'
      or coalesce((v_shot ->> 'distance_id') !~ v_uuid_re, true)
      or coalesce((v_shot ->> 'shot_event_id') !~ v_uuid_re, true)
      or coalesce((v_shot #>> '{end_number}') !~ '^[1-9][0-9]{0,15}$', true)
      or coalesce((v_shot #>> '{shot_number}') !~ '^[1-9][0-9]{0,15}$', true) then
      raise exception '矢の取り消しの指定が不正です。' using errcode = 'PT422';
    end if;
  end loop;

  perform 1 from users where id = auth.uid() for key share;

  perform 1 from rounds r
  where r.id in (
    select d.round_id
    from jsonb_array_elements(p_shots) as shot
    join distances d on d.id = (shot ->> 'distance_id')::uuid
  )
  order by r.id
  for share;

  -- 得点の記録・取消と距離構成の変更を、distanceの行ロックで同じ直列化境界に置く。ロックはID順に取る。
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
    v_end := (v_shot ->> 'end_number')::bigint;
    v_shot_number := (v_shot ->> 'shot_number')::bigint;

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

    select disabled_at, shooter_number into v_row_disabled_at, v_shooter_number from shots
    where distance_id = v_distance_id and end_number = v_end and shot_number = v_shot_number;
    if not found then
      v_results := v_results || jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'MISSING');
      continue;
    end if;

    -- 消えているマスを別の操作IDで消す要求は、書かずに効かない結果で返す(履歴に同じ消去を並べない)。
    if v_row_disabled_at is not null then
      v_results := v_results || jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'DISABLED');
      continue;
    end if;

    select greatest(
      (select max(e.revision) from shot_events e
        where e.distance_id = v_distance_id and e.end_number = v_end and e.shot_number = v_shot_number),
      (select s.revision from shots s
        where s.distance_id = v_distance_id and s.end_number = v_end and s.shot_number = v_shot_number),
      0
    ) + 1 into v_new_revision;

    insert into shot_events (
      event_id, round_id, distance_id, end_number, shot_number, type, author_id, revision, shooter_number
    )
    values (
      (v_shot ->> 'shot_event_id')::uuid, v_round_id, v_distance_id, v_end, v_shot_number, 'CLEARED', auth.uid(),
      v_new_revision, v_shooter_number
    );

    update shots
    set disabled_at = clock_timestamp(), revision = v_new_revision
    where distance_id = v_distance_id and end_number = v_end and shot_number = v_shot_number;

    v_results := v_results || jsonb_build_object('revision', v_new_revision, 'applied', true, 'reason', null::text);
  end loop;

  return v_results;
end;
$_$;

-- 射手の追加。番号が無ければ利用者に紐づかない射手を足し、あれば何も変えない。番号の省略は本体で拒否する。
CREATE FUNCTION "public"."add_round_shooter"("p_round_id" "uuid", "p_shooter_number" "jsonb" DEFAULT NULL) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_shooter_numeric numeric;
  v_shooter_number integer;
  v_round_disabled_at timestamptz;
begin
  -- 射手の番号は、型を確かめてから数値にし、範囲と整数性を確かめた値だけをintegerにする。
  if p_shooter_number is null or jsonb_typeof(p_shooter_number) <> 'number' then
    raise exception '射手の番号が不正です。' using errcode = 'PT422';
  end if;
  v_shooter_numeric := (p_shooter_number #>> '{}')::numeric;
  if v_shooter_numeric < 1 or v_shooter_numeric > 2147483647 or v_shooter_numeric <> trunc(v_shooter_numeric) then
    raise exception '射手の番号が不正です。' using errcode = 'PT422';
  end if;
  v_shooter_number := v_shooter_numeric::integer;

  perform 1 from users where id = auth.uid() for key share;

  select disabled_at into v_round_disabled_at
  from rounds
  where id = p_round_id
  for update;

  if not found then
    return jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'MISSING');
  end if;
  if not is_round_editor(p_round_id) then
    raise exception 'このラウンドに射手を追加する権限がありません。' using errcode = 'PT403';
  end if;
  if v_round_disabled_at is not null then
    return jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'DISABLED');
  end if;

  if not exists (
    select 1 from round_users where round_id = p_round_id and shooter_number = v_shooter_number
  ) then
    insert into round_users (round_id, shooter_number) values (p_round_id, v_shooter_number);
  end if;

  return jsonb_build_object('revision', null::bigint, 'applied', true, 'reason', null::text);
end;
$$;

ALTER FUNCTION "public"."add_round_shooter"("p_round_id" "uuid", "p_shooter_number" "jsonb") OWNER TO "postgres";
REVOKE EXECUTE ON FUNCTION "public"."add_round_shooter"("p_round_id" "uuid", "p_shooter_number" "jsonb") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."add_round_shooter"("p_round_id" "uuid", "p_shooter_number" "jsonb") TO "authenticated";

-- 1つのラウンドで、利用者の射手の紐づけと役割を外す内部関数。番号と行のIDは変えない。呼び出し側がラウンドをロックする。
CREATE FUNCTION "public"."anonymize_round_shooter"("p_round_id" "uuid", "p_user_id" "uuid") RETURNS void
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  update public.round_users
  set user_id = null, role = null
  where round_id = p_round_id and user_id = p_user_id and shooter_number is not null;
$$;

ALTER FUNCTION "public"."anonymize_round_shooter"("p_round_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";
REVOKE EXECUTE ON FUNCTION "public"."anonymize_round_shooter"("p_round_id" "uuid", "p_user_id" "uuid") FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION "public"."purge_account"(target_user_id uuid) RETURNS void
    LANGUAGE "plpgsql" SECURITY INVOKER
    SET "search_path" TO ''
    AS $$
declare
  v_deleted_user constant uuid := '00000000-0000-4000-8000-000000000001';
  v_round_ids uuid[];
  v_deleted_round_ids uuid[];
begin
  if target_user_id is null or target_user_id = v_deleted_user then
    raise exception 'account_purge_forbidden';
  end if;

  if not exists (select 1 from auth.users where id = target_user_id) then
    return;
  end if;

  -- 利用者、ラウンド(ID順)の順にロックし、同時の削除で射つ人のいないラウンドを残さない。
  perform 1 from public.users where id = target_user_id for update;

  select coalesce(array_agg(related.round_id), '{}')
  into v_round_ids
  from (
    select ru.round_id from public.round_users ru where ru.user_id = target_user_id
    union
    select e.round_id from public.round_events e where e.author_id = target_user_id
    union
    select e.round_id from public.distance_events e where e.author_id = target_user_id
    union
    select e.round_id from public.shot_events e where e.author_id = target_user_id
  ) as related;

  perform 1 from public.rounds r where r.id = any (v_round_ids) order by r.id for update;

  -- ロックの後の文で、射つ人の最新の人数を確かめる。
  select coalesce(array_agg(ru.round_id), '{}')
  into v_deleted_round_ids
  from public.round_users ru
  where ru.user_id = target_user_id
    and ru.role = 'owner'
    and not exists (
      select 1
      from public.round_users other
      where other.round_id = ru.round_id
        and other.role = 'owner'
        and other.user_id <> target_user_id
    );

  delete from public.shot_events where round_id = any (v_deleted_round_ids);
  delete from public.distance_events where round_id = any (v_deleted_round_ids);
  delete from public.round_events where round_id = any (v_deleted_round_ids);
  delete from public.rounds where id = any (v_deleted_round_ids);

  perform public.anonymize_round_shooter(ru.round_id, target_user_id)
  from public.round_users ru
  where ru.user_id = target_user_id and ru.shooter_number is not null;

  delete from public.round_users where user_id = target_user_id and shooter_number is null;

  update public.shot_events set author_id = v_deleted_user where author_id = target_user_id;
  update public.distance_events set author_id = v_deleted_user where author_id = target_user_id;
  update public.round_events set author_id = v_deleted_user where author_id = target_user_id;

  delete from auth.users where id = target_user_id;
end;
$$;

commit;
