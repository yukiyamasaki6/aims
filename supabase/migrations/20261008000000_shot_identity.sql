begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- 矢を1行1本とし、端末が作るUUID（id）で識別する。エンド内の位置（入力順の番号arrow_number）は射順でないため、残さない。
-- 射順は任意の属性shot_number（nullは射順不明）とし、書く経路はrecord_shotsだけにする。
--   - 同じエンドの生きている矢（disabled_atがnull）は、矢数を超えない。RPCが距離の行のロックの下で数え、制約トリガーが最後に止める。
--   - 同じエンドの生きている矢は、同じshot_numberを持たない（部分一意索引）。
--   - record_shotsは要素に含まれる項目だけを変え、効いた属性をイベントのset_fieldsに残す。
-- 更新前のビルドとの互換は持たない。旧い形（arrow_numberで指す要素）の要求はPT422で拒否する。

-- ============================================================
-- shots: 矢のID
-- ============================================================

-- 既存の行は無作為のUUIDで埋める（揮発の既定値は行ごとに評価される）。射順は不明（null）とする。
-- 主キーの付け替えと列の削除は、表の書き換えと排他ロックを伴う。shots・shot_eventsは小さく、この移行の中で止めてよいため、squawkの該当規則を個別に外す。
-- squawk-ignore adding-field-with-default
ALTER TABLE "public"."shots" ADD COLUMN "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL;
ALTER TABLE "public"."shots" ADD COLUMN "shot_number" bigint;
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "public"."shots" ADD CONSTRAINT "shots_shot_number_check" CHECK ("shot_number" >= 1);

COMMENT ON COLUMN "public"."shots"."id" IS '矢のID。新しい矢は端末が作る時刻順のUUID（UUIDv7の形式）。点数の変更・消去・復活で変わらない';
COMMENT ON COLUMN "public"."shots"."shot_number" IS 'エンド内で何射目か。nullは射順不明。1以上・矢数以下で、同じエンドの生きている矢で重ならない';

-- ============================================================
-- shot_events: 矢のIDと効いた属性
-- ============================================================

ALTER TABLE "public"."shot_events" ADD COLUMN "shot_id" "uuid";
ALTER TABLE "public"."shot_events" ADD COLUMN "shot_number" bigint;
ALTER TABLE "public"."shot_events" ADD COLUMN "set_fields" "text"[];

COMMENT ON COLUMN "public"."shot_events"."shot_id" IS '対象の矢のID';
COMMENT ON COLUMN "public"."shot_events"."shot_number" IS 'RECORDEDでset_fieldsにshot_numberを含むとき、記録した射順（nullは射順を外した）。それ以外はnull';
COMMENT ON COLUMN "public"."shot_events"."set_fields" IS 'RECORDEDで効いた属性（score、shooter_id、shot_number）。nullは全項目（既存のイベント）';

-- イベントは、同じマス（距離、エンド、入力順の番号）の行のIDを写す。
UPDATE "public"."shot_events" AS e
SET "shot_id" = s."id"
FROM "public"."shots" AS s
WHERE s."distance_id" = e."distance_id"
  AND s."end_number" = e."end_number"
  AND s."arrow_number" = e."arrow_number";

-- 行の無いマス（空のマスへの取り消し）のイベントは、マスごとに無作為のUUIDを1つ作り、同じマスのイベントに揃えて付ける。
WITH "cells" AS MATERIALIZED (
  SELECT "distance_id", "end_number", "arrow_number", "gen_random_uuid"() AS "shot_id"
  FROM (
    SELECT DISTINCT "distance_id", "end_number", "arrow_number"
    FROM "public"."shot_events"
    WHERE "shot_id" IS NULL
  ) AS "c"
)
UPDATE "public"."shot_events" AS e
SET "shot_id" = c."shot_id"
FROM "cells" AS c
WHERE e."shot_id" IS NULL
  AND c."distance_id" = e."distance_id"
  AND c."end_number" = e."end_number"
  AND c."arrow_number" = e."arrow_number";

-- squawk-ignore adding-not-nullable-field
ALTER TABLE "public"."shot_events" ALTER COLUMN "shot_id" SET NOT NULL;

-- 移行の確認: 生きている矢が矢数を超えるエンドがあれば、移行を止める。
do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from (
    select 1
    from shots s
    join distances d on d.id = s.distance_id
    where s.disabled_at is null
    group by s.distance_id, s.end_number, d.arrows_per_end
    having count(*) > d.arrows_per_end
  ) as over;
  if v_count > 0 then
    raise exception '生きている矢が矢数を超えるエンドがあります: % 件', v_count;
  end if;
end;
$$;

-- 主キー・一意をIDへ移し、入力順の番号の列を削除する。
ALTER TABLE "public"."shots" DROP CONSTRAINT "shots_pkey";
-- squawk-ignore constraint-missing-not-valid, adding-serial-primary-key-field
ALTER TABLE "public"."shots" ADD CONSTRAINT "shots_pkey" PRIMARY KEY ("id");
-- squawk-ignore ban-drop-column
ALTER TABLE "public"."shots" DROP COLUMN "arrow_number";

ALTER TABLE "public"."shot_events" DROP CONSTRAINT "shot_events_distance_id_end_number_arrow_number_revision_key";
-- squawk-ignore constraint-missing-not-valid, disallowed-unique-constraint
ALTER TABLE "public"."shot_events" ADD CONSTRAINT "shot_events_shot_id_revision_key" UNIQUE ("shot_id", "revision");
-- squawk-ignore ban-drop-column
ALTER TABLE "public"."shot_events" DROP COLUMN "arrow_number";

-- squawk-ignore require-concurrent-index-creation
CREATE INDEX "shots_live_end_idx" ON "public"."shots" ("distance_id", "end_number");
-- squawk-ignore require-concurrent-index-creation
CREATE UNIQUE INDEX "shots_live_shot_number_key" ON "public"."shots" ("distance_id", "end_number", "shot_number")
  WHERE "disabled_at" IS NULL AND "shot_number" IS NOT NULL;

-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "public"."shot_events" ADD CONSTRAINT "shot_events_shot_number_check" CHECK ("shot_number" >= 1);

ALTER TABLE "public"."shot_events" DROP CONSTRAINT "shot_events_payload_by_type";
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "public"."shot_events" ADD CONSTRAINT "shot_events_payload_by_type" CHECK (
  ("type" = 'RECORDED' AND "set_fields" IS NULL AND "shooter_id" IS NOT NULL AND "score_str" IS NOT NULL AND "score_int" IS NOT NULL AND "shot_number" IS NULL)
  OR (
    "type" = 'RECORDED' AND "set_fields" IS NOT NULL
    AND 'score' = ANY ("set_fields")
    AND "set_fields" <@ ARRAY['score', 'shooter_id', 'shot_number']
    AND "shooter_id" IS NOT NULL AND "score_str" IS NOT NULL AND "score_int" IS NOT NULL
    AND (('shot_number' = ANY ("set_fields")) OR "shot_number" IS NULL)
  )
  OR ("type" = 'CLEARED' AND "set_fields" IS NULL AND "shooter_id" IS NULL AND "score_str" IS NULL AND "score_int" IS NULL AND "shot_number" IS NULL)
);

-- ============================================================
-- 矢数の上限の制約トリガー
-- ============================================================

-- RPCの判定に漏れがあっても、生きている矢がエンドの矢数を超える書き込みを止める。
-- 距離の行をロックして数えるため、同じ距離への書き込みと直列化される。
CREATE FUNCTION "public"."shots_capacity_guard"() RETURNS "trigger"
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

CREATE CONSTRAINT TRIGGER "shots_capacity_guard"
  AFTER INSERT OR UPDATE OF "disabled_at", "end_number", "distance_id" ON "public"."shots"
  FOR EACH ROW
  WHEN ("new"."disabled_at" IS NULL)
  EXECUTE FUNCTION "public"."shots_capacity_guard"();

CREATE FUNCTION "public"."distances_capacity_guard"() RETURNS "trigger"
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

CREATE CONSTRAINT TRIGGER "distances_capacity_guard"
  AFTER UPDATE OF "arrows_per_end", "total_ends" ON "public"."distances"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."distances_capacity_guard"();

-- ============================================================
-- 補助関数
-- ============================================================

-- 矢が距離の構成（的・エンド数・矢数）で有効か。射順はnull（射順不明）か1〜矢数。M/0は常に有効とする（クライアントが固定で足す）。
-- エンドの矢の数が矢数以下であることは、record_shots・update_distance・制約トリガーが数えて判定する。
DROP FUNCTION "public"."shot_fits"("p_target_face_id" "uuid", "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_end" bigint, "p_arrow" bigint, "p_score_str" "text", "p_score_int" bigint);

CREATE FUNCTION "public"."shot_fits"("p_target_face_id" "uuid", "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_end" bigint, "p_shot_number" bigint, "p_score_str" "text", "p_score_int" bigint) RETURNS boolean
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

-- ============================================================
-- 距離の構成
-- ============================================================

-- 表示中の矢に新しい構成で無効なもの（射順の範囲を含む）があるか、生きている矢の数が新しい矢数を超えるエンドがあれば、configを効かせない。
-- シグネチャと戻り値が同じため、CREATE OR REPLACEで所有者と権限は保たれる。
CREATE OR REPLACE FUNCTION "public"."update_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid", "p_changes" "jsonb") RETURNS "jsonb"
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
$$;

-- ============================================================
-- 矢
-- ============================================================

-- 要素は{shot_event_id, shot_id, distance_id, end_number, score_str, score_int, shooter_id?, shot_number?}。
-- 射手と射順はキーがあるときだけ変える（射順のnullは射順を外す）。新しい矢で射手が無ければ実行者にする。
-- 返り値は入力の配列と同じ順の、{revision, applied, applied_fields, rejected_fields, reason}の配列。
-- applied_fieldsは効いた属性（score、shooter_id、shot_number）で、イベントのset_fieldsと同じ。
-- 同じ矢が配列に複数あれば、先行の要素のrevisionを読んで採番するためrevisionが増えていく。
-- シグネチャと戻り値が同じため、CREATE OR REPLACEで所有者と権限は保たれる。
CREATE OR REPLACE FUNCTION "public"."record_shots"("p_shots" "jsonb") RETURNS "jsonb"
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
  -- 契約の検証。旧い形（arrow_numberで指す要素、shot_idの無い要素）は拒否する。
  if p_shots is null or jsonb_typeof(p_shots) <> 'array' or jsonb_array_length(p_shots) > 100 then
    raise exception '矢の記録は100件以下の配列で指定してください。' using errcode = 'PT422';
  end if;
  for v_shot in select * from jsonb_array_elements(p_shots)
  loop
    if jsonb_typeof(v_shot) <> 'object'
      or v_shot ? 'arrow_number'
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

    -- イベントログ導入前の行はイベントを持たず、射影のrevisionだけが進んでいる。両方を見て採番する。
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
$$;


-- 要素は{shot_event_id, shot_id, distance_id}。存在しない矢はMISSINGで、記録しない。
-- 取り消し済みの矢へのクリアも効いた操作として記録する（後に確定した操作が勝つ規則を、どちらの順でも同じにする）。射順は変えない。
-- 返り値は入力の配列と同じ順の、{revision, applied, reason}の配列。
CREATE OR REPLACE FUNCTION "public"."clear_shots"("p_shots" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  -- 契約の検証。旧い形（arrow_numberで指す要素、shot_idの無い要素）は拒否する。
  if p_shots is null or jsonb_typeof(p_shots) <> 'array' or jsonb_array_length(p_shots) > 100 then
    raise exception '矢の取り消しは100件以下の配列で指定してください。' using errcode = 'PT422';
  end if;
  for v_shot in select * from jsonb_array_elements(p_shots)
  loop
    if jsonb_typeof(v_shot) <> 'object'
      or v_shot ? 'arrow_number'
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
$$;


-- 作り直した関数には既定の実行権限（PUBLIC）が付くため、剥奪する。
-- shot_fitsとトリガーの関数は内部関数のため、どのAPIロールにも実行させない（SECURITY DEFINER関数は所有者の権限で呼ぶ。トリガー関数のEXECUTEは発火時に要求されない）。
REVOKE EXECUTE ON FUNCTION "public"."shot_fits"("p_target_face_id" "uuid", "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_end" bigint, "p_shot_number" bigint, "p_score_str" "text", "p_score_int" bigint) FROM PUBLIC, "anon", "authenticated";
REVOKE EXECUTE ON FUNCTION "public"."shots_capacity_guard"() FROM PUBLIC, "anon", "authenticated";
REVOKE EXECUTE ON FUNCTION "public"."distances_capacity_guard"() FROM PUBLIC, "anon", "authenticated";

commit;
