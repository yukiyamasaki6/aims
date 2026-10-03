begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- 操作の持ち方の統一（段階1）: 書き込みRPCが、確定した対象のrevisionを返すようにする。
-- 端末は、返されたrevisionと取得結果のrevisionを比べて、確定した操作が取得に反映済みかを判定する。
-- 重複したevent_idの再送は、イベントも射影も変えず、既存のイベントのrevisionを返す。
-- 検証の順序は、行のロック、権限の確認、重複の判定、状態に依存する検証、イベントの追記と射影の更新に揃える。
-- 確定済みの操作の再送が、その後に変わった状態のために拒否されないようにするため、
-- 重複の判定は状態に依存する検証より先に行う。権限の確認は重複の判定より前に置き、
-- 権限のない呼び出しへ既存のイベントのrevisionを返さない。
-- 返り値の型はCREATE OR REPLACEで変えられないため、DROPして再作成し、実行権限を付け直す。

DROP FUNCTION "public"."update_round"("p_round_event_id" "uuid", "p_round_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text");

CREATE FUNCTION "public"."update_round"("p_round_event_id" "uuid", "p_round_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_revision bigint;
  v_event_revision bigint;
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

  select revision into v_event_revision from round_events where event_id = p_round_event_id;
  if found then
    return v_event_revision;
  end if;

  if p_format <> 'field' and exists (
    select 1 from distances
    where round_id = p_round_id and is_marked = false and disabled_at is null
  ) then
    raise exception 'Unmarkedの距離が残っているため、フィールド以外の種別には変更できません。先に各距離をMarkedに変更してください。';
  end if;

  insert into round_events (event_id, round_id, type, author_id, revision, name, round_date, format, bow_type)
  values (p_round_event_id, p_round_id, 'UPDATED', auth.uid(), v_revision + 1, p_name, p_round_date, p_format, p_bow_type);

  update rounds
  set name = p_name, round_date = p_round_date, format = p_format, bow_type = p_bow_type, revision = v_revision + 1
  where id = p_round_id;

  return v_revision + 1;
end;
$$;

ALTER FUNCTION "public"."update_round"("p_round_event_id" "uuid", "p_round_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text") OWNER TO "postgres";


DROP FUNCTION "public"."create_distance"("p_distance_event_id" "uuid", "p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean);

CREATE FUNCTION "public"."create_distance"("p_distance_event_id" "uuid", "p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_format text;
  v_event_revision bigint;
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

  select revision into v_event_revision from distance_events where event_id = p_distance_event_id;
  if found then
    return v_event_revision;
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
  );

  insert into distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked, revision)
  values (p_id, p_round_id, p_position_key, p_distance, p_total_ends, p_arrows_per_end, p_target_face_id, p_is_marked, 1);

  return 1;
end;
$$;

ALTER FUNCTION "public"."create_distance"("p_distance_event_id" "uuid", "p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) OWNER TO "postgres";


DROP FUNCTION "public"."update_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean);

CREATE FUNCTION "public"."update_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) RETURNS bigint
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
  v_event_revision bigint;
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

  select revision into v_event_revision from distance_events where event_id = p_distance_event_id;
  if found then
    return v_event_revision;
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
  from distances where id = p_distance_id;

  update distances
  set
    distance = p_distance,
    total_ends = p_total_ends,
    arrows_per_end = p_arrows_per_end,
    target_face_id = p_target_face_id,
    is_marked = p_is_marked,
    revision = v_revision + 1
  where id = p_distance_id;

  return v_revision + 1;
end;
$$;

ALTER FUNCTION "public"."update_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) OWNER TO "postgres";


DROP FUNCTION "public"."disable_round"("p_round_event_id" "uuid", "p_round_id" "uuid");

CREATE FUNCTION "public"."disable_round"("p_round_event_id" "uuid", "p_round_id" "uuid") RETURNS bigint
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
    raise exception 'このラウンドを削除する権限がありません。';
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


DROP FUNCTION "public"."disable_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid");

CREATE FUNCTION "public"."disable_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_round_id uuid;
  v_revision bigint;
  v_event_revision bigint;
begin
  select round_id into v_round_id from distances where id = p_distance_id;

  select revision into v_revision
  from distances
  where id = p_distance_id
  for update;

  if v_round_id is null or not is_round_editor(v_round_id) then
    raise exception 'この距離を削除する権限がありません。';
  end if;

  select revision into v_event_revision from distance_events where event_id = p_distance_event_id;
  if found then
    return v_event_revision;
  end if;

  insert into distance_events (event_id, round_id, distance_id, type, author_id, revision)
  values (p_distance_event_id, v_round_id, p_distance_id, 'DISABLED', auth.uid(), v_revision + 1);

  update distances
  set disabled_at = coalesce(disabled_at, clock_timestamp()), revision = v_revision + 1
  where id = p_distance_id;

  return v_revision + 1;
end;
$$;

ALTER FUNCTION "public"."disable_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid") OWNER TO "postgres";


DROP FUNCTION "public"."record_shots"("p_shots" "jsonb");

-- 返り値は入力の配列と同じ順の、イベントごとのrevision。
-- 同じマスが配列に複数あれば、先行イベントのrevisionを読んで採番するためrevisionが増えていく。
-- 重複したevent_idの要素は追記せず、既存のイベントのrevisionを返す。
CREATE FUNCTION "public"."record_shots"("p_shots" "jsonb") RETURNS bigint[]
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_shot jsonb;
  v_distance_id uuid;
  v_round_id uuid;
  v_shooter_id uuid;
  v_current_revision bigint;
  v_revisions bigint[] := '{}';
  v_event_revision bigint;
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
      select revision into v_event_revision from shot_events where event_id = (v_shot ->> 'shot_event_id')::uuid;
      v_revisions := array_append(v_revisions, v_event_revision);
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

    v_revisions := array_append(v_revisions, coalesce(v_current_revision, 0) + 1);
  end loop;

  return v_revisions;
end;
$$;

ALTER FUNCTION "public"."record_shots"("p_shots" "jsonb") OWNER TO "postgres";


DROP FUNCTION "public"."clear_shots"("p_shots" "jsonb");

CREATE FUNCTION "public"."clear_shots"("p_shots" "jsonb") RETURNS bigint[]
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_shot jsonb;
  v_distance_id uuid;
  v_round_id uuid;
  v_current_revision bigint;
  v_revisions bigint[] := '{}';
  v_event_revision bigint;
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
      select revision into v_event_revision from shot_events where event_id = (v_shot ->> 'shot_event_id')::uuid;
      v_revisions := array_append(v_revisions, v_event_revision);
      continue;
    end if;

    update shots
    set disabled_at = clock_timestamp(), revision = coalesce(v_current_revision, 0) + 1
    where distance_id = v_distance_id
      and end_number = (v_shot ->> 'end_number')::bigint
      and arrow_number = (v_shot ->> 'arrow_number')::bigint;

    v_revisions := array_append(v_revisions, coalesce(v_current_revision, 0) + 1);
  end loop;

  return v_revisions;
end;
$$;

ALTER FUNCTION "public"."clear_shots"("p_shots" "jsonb") OWNER TO "postgres";


-- 再作成した関数には既定の実行権限（PUBLIC）が付くため、剥奪してauthenticatedだけに付け直す。
REVOKE EXECUTE ON FUNCTION "public"."update_round"("p_round_event_id" "uuid", "p_round_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text") FROM PUBLIC, "anon";
REVOKE EXECUTE ON FUNCTION "public"."create_distance"("p_distance_event_id" "uuid", "p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) FROM PUBLIC, "anon";
REVOKE EXECUTE ON FUNCTION "public"."update_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) FROM PUBLIC, "anon";
REVOKE EXECUTE ON FUNCTION "public"."disable_round"("p_round_event_id" "uuid", "p_round_id" "uuid") FROM PUBLIC, "anon";
REVOKE EXECUTE ON FUNCTION "public"."disable_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid") FROM PUBLIC, "anon";
REVOKE EXECUTE ON FUNCTION "public"."record_shots"("p_shots" "jsonb") FROM PUBLIC, "anon";
REVOKE EXECUTE ON FUNCTION "public"."clear_shots"("p_shots" "jsonb") FROM PUBLIC, "anon";

GRANT EXECUTE ON FUNCTION "public"."update_round"("p_round_event_id" "uuid", "p_round_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."create_distance"("p_distance_event_id" "uuid", "p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."update_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."disable_round"("p_round_event_id" "uuid", "p_round_id" "uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."disable_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."record_shots"("p_shots" "jsonb") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."clear_shots"("p_shots" "jsonb") TO "authenticated";

commit;
