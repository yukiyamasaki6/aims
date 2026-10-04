begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- 失敗の自動解決（同期の統一 段階2）。
-- 書き込みRPCは、確定の順で、操作の項目ごとに「効く」か「効かない」かを判定する。
--   - 効く項目だけを射影へ反映し、効いた項目だけをイベントに記録し、対象のrevisionを1つ進める。
--   - 効かなかった操作・項目は、イベントにも他の表にも記録せず、応答で理由を返す。
--   - 拒否は、認可の拒否（PT403）と契約の不一致（PT422）だけにする。PTxyzはPostgRESTがHTTPステータスxyzとして返す。
--   - 設定の保存は、変えた項目だけを持つjsonbの差分（p_changes）で受ける。
-- 処理の順は、対象の存在（距離だけ。無ければMISSING）、行のロック、認可、重複の判定、契約の検証、規則の判定、記録。
-- 確定済みの操作の再送が後から厳しくした検証で拒否されないよう、重複の判定は契約の検証より先に行う。

-- 事前の確認（変更しない）: 現在の構成で無効な、表示中の矢の件数。
-- 1件以上あっても矢は変えない。その距離は、矢を取り消すまで構成の変更が効かない。
-- shot_fitsはこの後に作るため、同じ条件を直接書いて数える。
do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from shots s
  join distances d on d.id = s.distance_id
  where s.disabled_at is null
    and d.disabled_at is null
    and not (
      s.end_number between 1 and d.total_ends
      and s.arrow_number between 1 and d.arrows_per_end
      and (
        (s.score_str = 'M' and s.score_int = 0)
        or exists (
          select 1
          from target_face_spots sp
          join target_face_rings r on r.spot_id = sp.id
          where sp.target_face_id = d.target_face_id
            and r.score_str = s.score_str
            and r.score_int = s.score_int
        )
      )
    );
  raise notice '現在の構成で無効な表示中の矢: % 件', v_count;
end;
$$;

-- ============================================================
-- イベントの表: 効いた項目の記録
-- ============================================================

ALTER TABLE "public"."round_events" ADD COLUMN IF NOT EXISTS "set_fields" "text"[];
ALTER TABLE "public"."distance_events" ADD COLUMN IF NOT EXISTS "set_fields" "text"[];

COMMENT ON COLUMN "public"."round_events"."set_fields" IS 'UPDATEDで効いた項目。nullは全項目（既存のイベントと作成）';
COMMENT ON COLUMN "public"."distance_events"."set_fields" IS 'UPDATEDで効いた項目。nullは全項目（既存のイベントと作成）';

ALTER TABLE "public"."round_events" DROP CONSTRAINT "round_events_payload_by_type";
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "public"."round_events" ADD CONSTRAINT "round_events_payload_by_type" CHECK (
  ("type" = 'DISABLED' AND "set_fields" IS NULL AND "name" IS NULL AND "round_date" IS NULL AND "format" IS NULL AND "bow_type" IS NULL)
  OR ("type" = 'CREATED' AND "set_fields" IS NULL AND "name" IS NOT NULL AND "round_date" IS NOT NULL AND "format" IS NOT NULL AND "bow_type" IS NOT NULL)
  OR ("type" = 'UPDATED' AND "set_fields" IS NULL AND "name" IS NOT NULL AND "round_date" IS NOT NULL AND "format" IS NOT NULL AND "bow_type" IS NOT NULL)
  OR (
    "type" = 'UPDATED' AND "set_fields" IS NOT NULL
    AND "cardinality"("set_fields") > 0
    AND "set_fields" <@ ARRAY['name', 'round_date', 'format', 'bow_type']
    AND (NOT ('name' = ANY ("set_fields")) OR "name" IS NOT NULL)
    AND (NOT ('round_date' = ANY ("set_fields")) OR "round_date" IS NOT NULL)
    AND (NOT ('format' = ANY ("set_fields")) OR "format" IS NOT NULL)
    AND (NOT ('bow_type' = ANY ("set_fields")) OR "bow_type" IS NOT NULL)
  )
);

ALTER TABLE "public"."distance_events" DROP CONSTRAINT "distance_events_payload_by_type";
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "public"."distance_events" ADD CONSTRAINT "distance_events_payload_by_type" CHECK (
  ("type" = 'DISABLED' AND "set_fields" IS NULL AND "position_key" IS NULL AND "distance" IS NULL AND "is_marked" IS NULL AND "total_ends" IS NULL AND "arrows_per_end" IS NULL AND "target_face_id" IS NULL)
  OR (
    "type" IN ('CREATED', 'UPDATED') AND "set_fields" IS NULL
    AND "position_key" IS NOT NULL AND "is_marked" IS NOT NULL AND "total_ends" IS NOT NULL AND "arrows_per_end" IS NOT NULL AND "target_face_id" IS NOT NULL
    AND (("is_marked" = false) OR ("distance" IS NOT NULL))
  )
  OR (
    "type" = 'UPDATED' AND "set_fields" IS NOT NULL
    AND "cardinality"("set_fields") > 0
    AND "set_fields" <@ ARRAY['distance', 'is_marked', 'total_ends', 'arrows_per_end', 'target_face_id']
    AND "position_key" IS NOT NULL
    AND (NOT ('is_marked' = ANY ("set_fields")) OR "is_marked" IS NOT NULL)
    AND (('total_ends' = ANY ("set_fields")) = ('arrows_per_end' = ANY ("set_fields")))
    AND (('total_ends' = ANY ("set_fields")) = ('target_face_id' = ANY ("set_fields")))
    AND (NOT ('total_ends' = ANY ("set_fields")) OR ("total_ends" IS NOT NULL AND "arrows_per_end" IS NOT NULL AND "target_face_id" IS NOT NULL))
  )
);

-- ============================================================
-- 補助関数
-- ============================================================

-- 矢が距離の構成（的・エンド数・矢数）で有効か。M/0は常に有効とする（クライアントが固定で足す）。
CREATE FUNCTION "public"."shot_fits"("p_target_face_id" "uuid", "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_end" bigint, "p_arrow" bigint, "p_score_str" "text", "p_score_int" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select p_end between 1 and p_total_ends
    and p_arrow between 1 and p_arrows_per_end
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

ALTER FUNCTION "public"."shot_fits"("p_target_face_id" "uuid", "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_end" bigint, "p_arrow" bigint, "p_score_str" "text", "p_score_int" bigint) OWNER TO "postgres";

-- ============================================================
-- ラウンドの設定
-- ============================================================

DROP FUNCTION "public"."update_round"("p_round_event_id" "uuid", "p_round_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text");

CREATE FUNCTION "public"."update_round"("p_round_event_id" "uuid", "p_round_id" "uuid", "p_changes" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
    where k not in ('name', 'round_date', 'format', 'bow_type')
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

  if cardinality(v_applied) = 0 then
    return jsonb_build_object(
      'revision', null::bigint, 'applied', false, 'applied_fields', '[]'::jsonb,
      'rejected_fields', v_rejected, 'reason', null::text
    );
  end if;

  insert into round_events (event_id, round_id, type, author_id, revision, set_fields, name, round_date, format, bow_type)
  values (
    p_round_event_id, p_round_id, 'UPDATED', auth.uid(), v_revision + 1, v_applied,
    case when 'name' = any (v_applied) then v_name end,
    case when 'round_date' = any (v_applied) then v_round_date end,
    case when 'format' = any (v_applied) then v_new_format end,
    case when 'bow_type' = any (v_applied) then v_bow_type end
  );

  update rounds
  set
    name = case when 'name' = any (v_applied) then v_name else name end,
    round_date = case when 'round_date' = any (v_applied) then v_round_date else round_date end,
    format = case when 'format' = any (v_applied) then v_new_format else format end,
    bow_type = case when 'bow_type' = any (v_applied) then v_bow_type else bow_type end,
    revision = v_revision + 1
  where id = p_round_id;

  return jsonb_build_object(
    'revision', v_revision + 1, 'applied', true, 'applied_fields', to_jsonb(v_applied),
    'rejected_fields', v_rejected, 'reason', null::text
  );
end;
$$;

ALTER FUNCTION "public"."update_round"("p_round_event_id" "uuid", "p_round_id" "uuid", "p_changes" "jsonb") OWNER TO "postgres";


-- disable_roundは操作の列の外（完了を待つダイアログ）のまま、拒否のSQLSTATEだけをPT403にする。
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

-- ============================================================
-- 距離
-- ============================================================

DROP FUNCTION "public"."create_distance"("p_distance_event_id" "uuid", "p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean);

CREATE FUNCTION "public"."create_distance"("p_distance_event_id" "uuid", "p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) RETURNS "jsonb"
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
  if exists (select 1 from distances where round_id = p_round_id and position_key = p_position_key) then
    raise exception '同じ位置の距離が既に存在します。' using errcode = 'PT422';
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


DROP FUNCTION "public"."update_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean);

CREATE FUNCTION "public"."update_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid", "p_changes" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
        and not shot_fits(v_new_target_face_id, v_new_total_ends, v_new_arrows_per_end, s.end_number, s.arrow_number, s.score_str, s.score_int)
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
$$;

ALTER FUNCTION "public"."update_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid", "p_changes" "jsonb") OWNER TO "postgres";


DROP FUNCTION "public"."disable_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid");

CREATE FUNCTION "public"."disable_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid") RETURNS "jsonb"
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

-- ============================================================
-- 矢
-- ============================================================

DROP FUNCTION "public"."record_shots"("p_shots" "jsonb");

-- 返り値は入力の配列と同じ順の、{revision, applied, reason}の配列。
-- 同じマスが配列に複数あれば、先行の要素のrevisionを読んで採番するためrevisionが増えていく。
CREATE FUNCTION "public"."record_shots"("p_shots" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_shot jsonb;
  v_distance_id uuid;
  v_round_id uuid;
  v_round_disabled_at timestamptz;
  v_distance_disabled_at timestamptz;
  v_total_ends bigint;
  v_arrows_per_end bigint;
  v_target_face_id uuid;
  v_shooter_id uuid;
  v_end bigint;
  v_arrow bigint;
  v_score_str text;
  v_score_int bigint;
  v_new_revision bigint;
  v_event_revision bigint;
  v_results jsonb := '[]'::jsonb;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  -- 契約の検証
  if p_shots is null or jsonb_typeof(p_shots) <> 'array' or jsonb_array_length(p_shots) > 100 then
    raise exception '矢の記録は100件以下の配列で指定してください。' using errcode = 'PT422';
  end if;
  for v_shot in select * from jsonb_array_elements(p_shots)
  loop
    if jsonb_typeof(v_shot) <> 'object'
      or coalesce(jsonb_typeof(v_shot -> 'distance_id'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'shot_event_id'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'end_number'), '') <> 'number'
      or coalesce(jsonb_typeof(v_shot -> 'arrow_number'), '') <> 'number'
      or coalesce(jsonb_typeof(v_shot -> 'score_str'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'score_int'), '') <> 'number'
      or coalesce((v_shot ->> 'distance_id') !~ v_uuid_re, true)
      or coalesce((v_shot ->> 'shot_event_id') !~ v_uuid_re, true)
      or coalesce((v_shot #>> '{end_number}') !~ '^[1-9][0-9]{0,15}$', true)
      or coalesce((v_shot #>> '{arrow_number}') !~ '^[1-9][0-9]{0,15}$', true)
      or coalesce((v_shot #>> '{score_int}') !~ '^-?[0-9]{1,15}$', true)
      or (v_shot ->> 'score_str') = ''
      or (
        coalesce(jsonb_typeof(v_shot -> 'shooter_id'), 'null') <> 'null'
        and (jsonb_typeof(v_shot -> 'shooter_id') <> 'string' or coalesce((v_shot ->> 'shooter_id') !~ v_uuid_re, true))
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
    v_end := (v_shot ->> 'end_number')::bigint;
    v_arrow := (v_shot ->> 'arrow_number')::bigint;
    v_score_str := v_shot ->> 'score_str';
    v_score_int := (v_shot ->> 'score_int')::bigint;

    select d.round_id, d.disabled_at, d.total_ends, d.arrows_per_end, d.target_face_id, r.disabled_at
      into v_round_id, v_distance_disabled_at, v_total_ends, v_arrows_per_end, v_target_face_id, v_round_disabled_at
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

    -- shooter_idは省略時のみ実行者本人（auth.uid()）を使う。省略しない場合も
    -- 「誰の代理で記録するか」を選ぶだけであり、権限自体は上のis_round_editor()で判定済みなので、
    -- author_idに相当する実行者情報がクライアント入力に左右されることはない。
    v_shooter_id := coalesce((v_shot ->> 'shooter_id')::uuid, auth.uid());

    if not exists (
      select 1 from round_users
      where round_id = v_round_id and user_id = v_shooter_id
    ) then
      raise exception '指定された射手はこのラウンドのメンバーではありません。' using errcode = 'PT403';
    end if;

    if v_round_disabled_at is not null or v_distance_disabled_at is not null then
      v_results := v_results || jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'DISABLED');
      continue;
    end if;

    if not shot_fits(v_target_face_id, v_total_ends, v_arrows_per_end, v_end, v_arrow, v_score_str, v_score_int) then
      v_results := v_results || jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'UNFIT');
      continue;
    end if;

    -- イベントログ導入前の行はイベントを持たず、射影のrevisionだけが進んでいる。両方を見て採番する。
    select greatest(
      (select max(e.revision) from shot_events e
        where e.distance_id = v_distance_id and e.end_number = v_end and e.arrow_number = v_arrow),
      (select s.revision from shots s
        where s.distance_id = v_distance_id and s.end_number = v_end and s.arrow_number = v_arrow),
      0
    ) + 1 into v_new_revision;

    insert into shot_events (
      event_id, distance_id, type, author_id, revision, end_number, arrow_number, shooter_id, score_str, score_int
    )
    values (
      (v_shot ->> 'shot_event_id')::uuid, v_distance_id, 'RECORDED', auth.uid(), v_new_revision,
      v_end, v_arrow, v_shooter_id, v_score_str, v_score_int
    );

    insert into shots (distance_id, end_number, arrow_number, shooter_id, score_str, score_int, revision)
    values (v_distance_id, v_end, v_arrow, v_shooter_id, v_score_str, v_score_int, v_new_revision)
    on conflict (distance_id, end_number, arrow_number)
    do update set
      shooter_id = excluded.shooter_id,
      score_str = excluded.score_str,
      score_int = excluded.score_int,
      revision = excluded.revision,
      disabled_at = null;

    v_results := v_results || jsonb_build_object('revision', v_new_revision, 'applied', true, 'reason', null::text);
  end loop;

  return v_results;
end;
$$;

ALTER FUNCTION "public"."record_shots"("p_shots" "jsonb") OWNER TO "postgres";


DROP FUNCTION "public"."clear_shots"("p_shots" "jsonb");

CREATE FUNCTION "public"."clear_shots"("p_shots" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_shot jsonb;
  v_distance_id uuid;
  v_round_id uuid;
  v_round_disabled_at timestamptz;
  v_distance_disabled_at timestamptz;
  v_end bigint;
  v_arrow bigint;
  v_new_revision bigint;
  v_event_revision bigint;
  v_results jsonb := '[]'::jsonb;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  -- 契約の検証
  if p_shots is null or jsonb_typeof(p_shots) <> 'array' or jsonb_array_length(p_shots) > 100 then
    raise exception '矢の取り消しは100件以下の配列で指定してください。' using errcode = 'PT422';
  end if;
  for v_shot in select * from jsonb_array_elements(p_shots)
  loop
    if jsonb_typeof(v_shot) <> 'object'
      or coalesce(jsonb_typeof(v_shot -> 'distance_id'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'shot_event_id'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'end_number'), '') <> 'number'
      or coalesce(jsonb_typeof(v_shot -> 'arrow_number'), '') <> 'number'
      or coalesce((v_shot ->> 'distance_id') !~ v_uuid_re, true)
      or coalesce((v_shot ->> 'shot_event_id') !~ v_uuid_re, true)
      or coalesce((v_shot #>> '{end_number}') !~ '^[1-9][0-9]{0,15}$', true)
      or coalesce((v_shot #>> '{arrow_number}') !~ '^[1-9][0-9]{0,15}$', true) then
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
    v_end := (v_shot ->> 'end_number')::bigint;
    v_arrow := (v_shot ->> 'arrow_number')::bigint;

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

    select greatest(
      (select max(e.revision) from shot_events e
        where e.distance_id = v_distance_id and e.end_number = v_end and e.arrow_number = v_arrow),
      (select s.revision from shots s
        where s.distance_id = v_distance_id and s.end_number = v_end and s.arrow_number = v_arrow),
      0
    ) + 1 into v_new_revision;

    -- 空のマスへの取り消しも効かせた操作として記録し、マスの採番を進める。
    insert into shot_events (event_id, distance_id, type, author_id, revision, end_number, arrow_number)
    values (
      (v_shot ->> 'shot_event_id')::uuid, v_distance_id, 'CLEARED', auth.uid(), v_new_revision, v_end, v_arrow
    );

    update shots
    set disabled_at = clock_timestamp(), revision = v_new_revision
    where distance_id = v_distance_id
      and end_number = v_end
      and arrow_number = v_arrow;

    v_results := v_results || jsonb_build_object('revision', v_new_revision, 'applied', true, 'reason', null::text);
  end loop;

  return v_results;
end;
$$;

ALTER FUNCTION "public"."clear_shots"("p_shots" "jsonb") OWNER TO "postgres";


-- 再作成した関数には既定の実行権限（PUBLIC）が付くため、剥奪してauthenticatedだけに付け直す。
-- shot_fitsは内部関数のため、どのAPIロールにも実行させない（SECURITY DEFINER関数は所有者の権限で呼ぶ）。
REVOKE EXECUTE ON FUNCTION "public"."shot_fits"("p_target_face_id" "uuid", "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_end" bigint, "p_arrow" bigint, "p_score_str" "text", "p_score_int" bigint) FROM PUBLIC, "anon", "authenticated";
REVOKE EXECUTE ON FUNCTION "public"."update_round"("p_round_event_id" "uuid", "p_round_id" "uuid", "p_changes" "jsonb") FROM PUBLIC, "anon";
REVOKE EXECUTE ON FUNCTION "public"."create_distance"("p_distance_event_id" "uuid", "p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) FROM PUBLIC, "anon";
REVOKE EXECUTE ON FUNCTION "public"."update_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid", "p_changes" "jsonb") FROM PUBLIC, "anon";
REVOKE EXECUTE ON FUNCTION "public"."disable_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid") FROM PUBLIC, "anon";
REVOKE EXECUTE ON FUNCTION "public"."record_shots"("p_shots" "jsonb") FROM PUBLIC, "anon";
REVOKE EXECUTE ON FUNCTION "public"."clear_shots"("p_shots" "jsonb") FROM PUBLIC, "anon";

GRANT EXECUTE ON FUNCTION "public"."update_round"("p_round_event_id" "uuid", "p_round_id" "uuid", "p_changes" "jsonb") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."create_distance"("p_distance_event_id" "uuid", "p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."update_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid", "p_changes" "jsonb") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."disable_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."record_shots"("p_shots" "jsonb") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."clear_shots"("p_shots" "jsonb") TO "authenticated";

commit;
