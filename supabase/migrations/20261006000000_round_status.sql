begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- ラウンドの状態（入力中/完了）。
-- 状態はラウンドの項目の1つで、update_roundの差分のキー`status`で変える。後勝ち・削除済みの判定・認可・冪等は他の項目と同じ。
-- 既存のラウンドは完了とし、以降に作るラウンドは入力中で始まる。移行ではイベントを書かない。

ALTER TABLE "public"."rounds" ADD COLUMN "status" "text" DEFAULT 'completed' NOT NULL;
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "public"."rounds" ADD CONSTRAINT "rounds_status_check" CHECK ("status" IN ('in_progress', 'completed'));
ALTER TABLE "public"."rounds" ALTER COLUMN "status" SET DEFAULT 'in_progress';

COMMENT ON COLUMN "public"."rounds"."status" IS 'ラウンドの状態。in_progress（入力中）かcompleted（完了）';

ALTER TABLE "public"."round_events" ADD COLUMN "status" "text";
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "public"."round_events" ADD CONSTRAINT "round_events_status_check" CHECK ("status" IS NULL OR "status" IN ('in_progress', 'completed'));

COMMENT ON COLUMN "public"."round_events"."status" IS 'UPDATEDでstatusが効いたときの値。作成と、statusが効いていないUPDATEDはnull';

ALTER TABLE "public"."round_events" DROP CONSTRAINT "round_events_payload_by_type";
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "public"."round_events" ADD CONSTRAINT "round_events_payload_by_type" CHECK (
  ("type" = 'DISABLED' AND "set_fields" IS NULL AND "name" IS NULL AND "round_date" IS NULL AND "format" IS NULL AND "bow_type" IS NULL AND "status" IS NULL)
  OR ("type" = 'CREATED' AND "set_fields" IS NULL AND "name" IS NOT NULL AND "round_date" IS NOT NULL AND "format" IS NOT NULL AND "bow_type" IS NOT NULL AND "status" IS NULL)
  OR ("type" = 'UPDATED' AND "set_fields" IS NULL AND "name" IS NOT NULL AND "round_date" IS NOT NULL AND "format" IS NOT NULL AND "bow_type" IS NOT NULL AND "status" IS NULL)
  OR (
    "type" = 'UPDATED' AND "set_fields" IS NOT NULL
    AND "cardinality"("set_fields") > 0
    AND "set_fields" <@ ARRAY['name', 'round_date', 'format', 'bow_type', 'status']
    AND (NOT ('name' = ANY ("set_fields")) OR "name" IS NOT NULL)
    AND (NOT ('round_date' = ANY ("set_fields")) OR "round_date" IS NOT NULL)
    AND (NOT ('format' = ANY ("set_fields")) OR "format" IS NOT NULL)
    AND (NOT ('bow_type' = ANY ("set_fields")) OR "bow_type" IS NOT NULL)
    AND (NOT ('status' = ANY ("set_fields")) OR "status" IS NOT NULL)
  )
);

CREATE OR REPLACE FUNCTION "public"."update_round"("p_round_event_id" "uuid", "p_round_id" "uuid", "p_changes" "jsonb") RETURNS "jsonb"
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
$$;

commit;
