begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- ラウンドの作成を、操作の列の操作として送れるようにする。
--   - 戻り値は旧版のクライアントとの互換のためuuidのまま。送信側がrevision 1の確定として扱う。
--   - 拒否は、認可の拒否（PT403）と契約の不一致（PT422）だけにする。PTxyzはPostgRESTがHTTPステータスxyzとして返す。
--   - 重複のevent_idは、契約の検証より先に判定する。作成者が違えばPT403、作成でないイベントならPT422、それ以外は作成済みのround_idを返す。
-- シグネチャと戻り値が同じため、CREATE OR REPLACEで所有者と権限は保たれる。

CREATE OR REPLACE FUNCTION "public"."create_round"("p_round_event_id" "uuid", "p_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_round_id uuid := p_id;
  v_distance jsonb;
  v_event_type text;
  v_event_author uuid;
  v_event_round_id uuid;
  v_ids uuid[] := '{}';
  v_event_ids uuid[] := '{}';
  v_position_keys text[] := '{}';
  v_id uuid;
  v_event_id uuid;
  v_target_face_id uuid;
  v_is_marked boolean;
  v_distance_value numeric;
  v_max constant numeric := 9223372036854775807;
begin
  -- 重複の判定（契約の検証より先。確定済みの作成の再送が、後から厳しくした検証で拒否されないため）
  select type, author_id, round_id into v_event_type, v_event_author, v_event_round_id
  from round_events where event_id = p_round_event_id;
  if found then
    if v_event_author <> auth.uid() then
      raise exception 'このラウンドを作成した操作ではありません。' using errcode = 'PT403';
    end if;
    if v_event_type <> 'CREATED' then
      raise exception 'イベントIDが作成以外の操作で使われています。' using errcode = 'PT422';
    end if;
    return v_event_round_id;
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
    if v_id = any (v_ids) or v_event_id = any (v_event_ids)
      or (v_distance ->> 'position_key') = any (v_position_keys) then
      raise exception '距離のID・イベントID・位置が重複しています。' using errcode = 'PT422';
    end if;
    if exists (select 1 from distances where id = v_id) then
      raise exception '既に存在する距離IDです。' using errcode = 'PT422';
    end if;
    if exists (select 1 from distance_events where event_id = v_event_id) then
      raise exception '既に使われている距離のイベントIDです。' using errcode = 'PT422';
    end if;
    v_ids := v_ids || v_id;
    v_event_ids := v_event_ids || v_event_id;
    v_position_keys := v_position_keys || (v_distance ->> 'position_key');
  end loop;

  if exists (select 1 from rounds where id = p_id) then
    raise exception '既に存在するラウンドIDです。' using errcode = 'PT422';
  end if;

  -- 記録
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

commit;
