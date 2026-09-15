begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- issue459: ラウンド・距離・矢への書き込みは全てSECURITY DEFINER RPC経由に
-- 一本化し、対象テーブルへの直接INSERT/UPDATE/DELETEはRLSで拒否する。
-- 各RPCは対象の親関係から実際のラウンドを特定してis_round_editor()で検証し、
-- 実行者はクライアント入力ではなくauth.uid()に基づいて判定する。
-- この入力形式（RPCの引数）が、将来のイベント追記方式への置き換え境界となる
-- （呼び出し側のインターフェースを変えずに、内部実装だけをイベント追記へ
-- 差し替えられるようにする）。RPC名はdocs/erd.mdのround_events/
-- distance_events/shot_events.type（CREATED/UPDATED/DISABLED、
-- RECORDED/CLEARED）に対応する。現段階の物理削除はdeleteと明示し、
-- 将来のイベント移行時にDISABLEDへ置き換える。

-- update_round_config（旧名）をUPDATED相当のupdate_roundへ改名する。
DROP FUNCTION "public"."update_round_config"("p_round_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text");
DROP FUNCTION "public"."create_round"("p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb");

CREATE FUNCTION "public"."create_round"("p_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_round_id uuid := p_id;
  v_distance jsonb;
begin
  if exists (
    select 1
    from jsonb_array_elements(p_distances) as distance_input
    where jsonb_typeof(distance_input -> 'is_marked') is distinct from 'boolean'
  ) then
    raise exception '初期距離のis_markedは必須です。';
  end if;

  if p_format <> 'field' and exists (
    select 1
    from jsonb_array_elements(p_distances) as distance_input
    where (distance_input ->> 'is_marked')::boolean = false
  ) then
    raise exception 'Unmarkedの距離はフィールド種別でのみ使用できます。';
  end if;

  insert into round_users (round_id, user_id, role)
  values (v_round_id, auth.uid(), 'editor');

  insert into rounds (id, name, round_date, format, bow_type)
  values (v_round_id, p_name, p_round_date, p_format, p_bow_type);

  for v_distance in select * from jsonb_array_elements(p_distances)
  loop
    insert into distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked)
    values (
      (v_distance ->> 'id')::uuid,
      v_round_id,
      v_distance ->> 'position_key',
      (v_distance ->> 'distance')::bigint,
      (v_distance ->> 'total_ends')::bigint,
      (v_distance ->> 'arrows_per_end')::bigint,
      (v_distance ->> 'target_face_id')::uuid,
      (v_distance ->> 'is_marked')::boolean
    );
  end loop;

  return v_round_id;
end;
$$;


ALTER FUNCTION "public"."create_round"("p_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") OWNER TO "postgres";


CREATE FUNCTION "public"."update_round"("p_round_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- 距離の追加・更新も同じ親行を先にロックする。formatとis_markedの組合せを
  -- 検証してから更新する間に、別の編集者がUnmarked距離を追加・変更できない。
  perform 1
  from rounds
  where id = p_round_id
  for update;

  if not is_round_editor(p_round_id) then
    raise exception 'このラウンドを編集する権限がありません。';
  end if;

  if p_format <> 'field' and exists (
    select 1 from distances
    where round_id = p_round_id and is_marked = false
  ) then
    raise exception 'Unmarkedの距離が残っているため、フィールド以外の種別には変更できません。先に各距離をMarkedに変更してください。';
  end if;

  update rounds
  set name = p_name, round_date = p_round_date, format = p_format, bow_type = p_bow_type
  where id = p_round_id;
end;
$$;


ALTER FUNCTION "public"."update_round"("p_round_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_distance"("p_distance_id" "uuid", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_round_id uuid;
  v_format text;
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
  select total_ends, arrows_per_end, target_face_id
    into v_total_ends, v_arrows_per_end, v_target_face_id
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
    select 1 from shots where distance_id = p_distance_id
  ) into v_has_shots;

  -- shotsが1件でも存在する距離は、総エンド数・エンドあたりの本数に加えて
  -- 的（target_face_id）も変更させない。的の種類が変わると点数の意味も
  -- 変わってしまい、既に記録済みのshotsと整合しなくなるため（UI側でも
  -- 読み取り専用にしているが、ここでも防御的に無視する）。distance・
  -- is_markedは点数構成に関係しないメタ情報なので、shots有無にかかわらず
  -- 常に変更できる。構成列が違う要求は無言で捨てず、呼び出し側が再読込・
  -- 再入力できるよう明示的に失敗させる。
  if v_has_shots then
    if p_total_ends is distinct from v_total_ends
      or p_arrows_per_end is distinct from v_arrows_per_end
      or p_target_face_id is distinct from v_target_face_id then
      raise exception '既に得点が記録されているため、エンド数・矢数・的は変更できません。';
    end if;

    update distances
    set distance = p_distance, is_marked = p_is_marked
    where id = p_distance_id;
  else
    update distances
    set
      distance = p_distance,
      total_ends = p_total_ends,
      arrows_per_end = p_arrows_per_end,
      target_face_id = p_target_face_id,
      is_marked = p_is_marked
    where id = p_distance_id;
  end if;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."create_distance"("p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) RETURNS "void"
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

  insert into distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked)
  values (p_id, p_round_id, p_position_key, p_distance, p_total_ends, p_arrows_per_end, p_target_face_id, p_is_marked);
end;
$$;


ALTER FUNCTION "public"."create_distance"("p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_round"("p_round_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not is_round_editor(p_round_id) then
    raise exception 'このラウンドを削除する権限がありません。';
  end if;

  delete from rounds where id = p_round_id;
end;
$$;


ALTER FUNCTION "public"."delete_round"("p_round_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_distance"("p_distance_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_round_id uuid;
begin
  select round_id into v_round_id from distances where id = p_distance_id;

  if v_round_id is null or not is_round_editor(v_round_id) then
    raise exception 'この距離を削除する権限がありません。';
  end if;

  delete from distances where id = p_distance_id;
end;
$$;


ALTER FUNCTION "public"."delete_distance"("p_distance_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_shots"("p_shots" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_shot jsonb;
  v_distance_id uuid;
  v_round_id uuid;
  v_shooter_id uuid;
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

    insert into shots (distance_id, end_number, arrow_number, shooter_id, score_str, score_int)
    values (
      v_distance_id,
      (v_shot ->> 'end_number')::bigint,
      (v_shot ->> 'arrow_number')::bigint,
      v_shooter_id,
      v_shot ->> 'score_str',
      (v_shot ->> 'score_int')::bigint
    )
    on conflict (distance_id, end_number, arrow_number)
    do update set
      shooter_id = excluded.shooter_id,
      score_str = excluded.score_str,
      score_int = excluded.score_int;
  end loop;
end;
$$;


ALTER FUNCTION "public"."record_shots"("p_shots" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clear_shots"("p_shots" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_shot jsonb;
  v_distance_id uuid;
  v_round_id uuid;
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

    delete from shots
    where distance_id = v_distance_id
      and end_number = (v_shot ->> 'end_number')::bigint
      and arrow_number = (v_shot ->> 'arrow_number')::bigint;
  end loop;
end;
$$;


ALTER FUNCTION "public"."clear_shots"("p_shots" "jsonb") OWNER TO "postgres";


-- クライアントからの直接書き込みを拒否し、全ての変更をSECURITY DEFINER RPC
-- 経由に一本化する。SELECTポリシー（select_if_member）は維持する。

DROP POLICY "insert_if_editor" ON "public"."distances";
DROP POLICY "insert_if_editor" ON "public"."shots";

DROP POLICY "update_if_editor" ON "public"."distances";
DROP POLICY "update_if_editor" ON "public"."rounds";
DROP POLICY "update_if_editor" ON "public"."shots";

DROP POLICY "delete_if_editor" ON "public"."distances";
DROP POLICY "delete_if_editor" ON "public"."rounds";
DROP POLICY "delete_if_editor" ON "public"."shots";

-- GRANT自体は維持し（criterion 4は「RLSで拒否する」であり、GRANT剥奪による
-- permission denied ではなく、RLSポリシー不在によるrow-level security違反で
-- 拒否されるようにする）、上記のPOLICY削除だけでSELECT以外の直接操作を防ぐ。

-- PostgreSQLは関数作成時にPUBLICへEXECUTEを既定付与する。SECURITY DEFINERの
-- 書き込み関数を未認証リクエストからも呼べる状態にしないため、既存関数を
-- 含めて明示的に剥奪し、下でauthenticatedだけへ付与する。
REVOKE EXECUTE ON FUNCTION "public"."create_round"("p_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."update_round"("p_round_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."update_distance"("p_distance_id" "uuid", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."create_distance"("p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."delete_round"("p_round_id" "uuid") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."delete_distance"("p_distance_id" "uuid") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."record_shots"("p_shots" "jsonb") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."clear_shots"("p_shots" "jsonb") FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."update_round"("p_round_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text") TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."create_round"("p_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."update_distance"("p_distance_id" "uuid", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."create_distance"("p_id" "uuid", "p_round_id" "uuid", "p_position_key" "text", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."delete_round"("p_round_id" "uuid") TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."delete_distance"("p_distance_id" "uuid") TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."record_shots"("p_shots" "jsonb") TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."clear_shots"("p_shots" "jsonb") TO "authenticated";

commit;
