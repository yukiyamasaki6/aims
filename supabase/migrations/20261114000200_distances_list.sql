-- 履歴に距離単位の一覧(distances_list)を足す。ラウンド単位の結果は変えない。
--   - history_rounds: 呼び出し元の所属(round_users.user_id = auth.uid())から引いたroundsのうち、ラウンドの条件(無効でない、完了、種別、弓種、期間、距離の構成)に一致する行を返す。rounds_listとdistances_listが対象のラウンドとして読む
--     SECURITY INVOKERのSTABLEで、読む表はRLSを通る。SET search_pathを付けない唯一の関数で、付けると呼び出し元へ展開(インライン化)されず遅くなるため、本文の名前はpublic.・auth.で修飾する
--   - distances_list: 完了したラウンドの無効でない距離を1件ずつ、小計とともに返す。引数はrounds_listの11個に、距離の行p_distanceを末尾で足す(既定値null)。得点の範囲は小計が対象
--   - rounds_list: 署名・戻り値・並び・起点は変えず、対象のラウンドをhistory_roundsから読む形に置き換える(CREATE OR REPLACE。所有者と実行権限は保たれる)
--   - 実行権限はauthenticatedだけに与える。引数は検証しない
--   - 戻すときは、逆の内容の追加のmigrationで行う

begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

CREATE OR REPLACE FUNCTION "public"."history_rounds"("p_format" "text", "p_bow_type" "text", "p_date_from" "date", "p_date_to" "date", "p_distances" "jsonb") RETURNS SETOF "public"."rounds"
    LANGUAGE "sql" STABLE SECURITY INVOKER
    AS $$
  select r.*
  from public.round_users ru
  join public.rounds r on r.id = ru.round_id
  where ru.user_id = auth.uid()
    and r.disabled_at is null
    and r.status = 'completed'
    and (p_format is null or r.format = p_format)
    and (p_bow_type is null or r.bow_type = p_bow_type)
    and (p_date_from is null or r.round_date >= p_date_from)
    and (p_date_to is null or r.round_date <= p_date_to)
    and (p_distances is null or coalesce((
      select count(*) = jsonb_array_length(p_distances)
        and bool_and(coalesce(
          d.is_marked
          and d.distance = (c.value->>'distance')::bigint
          and (c.value->>'arrows_per_end' is null or d.arrows_per_end = (c.value->>'arrows_per_end')::bigint)
          and (c.value->>'total_arrows' is null or d.total_ends * d.arrows_per_end = (c.value->>'total_arrows')::bigint)
          and (c.value->>'target_face_id' is null or d.target_face_id = (c.value->>'target_face_id')::uuid),
          false))
      from (
        select dd.*, row_number() over (order by dd.position_key, dd.id) as n
        from public.distances dd
        where dd.round_id = r.id
          and dd.disabled_at is null
      ) d
      left join jsonb_array_elements(p_distances) with ordinality as c(value, n) on c.n = d.n
    ), false));
$$;

ALTER FUNCTION "public"."history_rounds"("p_format" "text", "p_bow_type" "text", "p_date_from" "date", "p_date_to" "date", "p_distances" "jsonb") OWNER TO "postgres";

REVOKE EXECUTE ON FUNCTION "public"."history_rounds"("p_format" "text", "p_bow_type" "text", "p_date_from" "date", "p_date_to" "date", "p_distances" "jsonb") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."history_rounds"("p_format" "text", "p_bow_type" "text", "p_date_from" "date", "p_date_to" "date", "p_distances" "jsonb") TO "authenticated";

-- 並び・戻り値・起点は20261114000100_rounds_list_query_efficiency.sqlと同じ。candidatesの対象のラウンドと条件をhistory_roundsから読む(得点の範囲だけここで絞る)。
CREATE OR REPLACE FUNCTION "public"."rounds_list"("p_sort_key" "text", "p_sort_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date" DEFAULT NULL, "p_date_to" "date" DEFAULT NULL, "p_score_min" bigint DEFAULT NULL, "p_score_max" bigint DEFAULT NULL, "p_distances" jsonb DEFAULT NULL) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY INVOKER
    SET "search_path" TO 'public'
    AS $$
  with
    p as (
      select
        case when p_sort_direction = 'asc' then 1 else -1 end as dir,
        coalesce(p_sort_key = 'score', false) as by_score
    ),
    candidates as (
      select
        r.id,
        r.name,
        r.round_date,
        r.created_at,
        t.total,
        (case when p.by_score then t.total else (r.round_date - date '2000-01-01')::numeric end) * p.dir as sort_val
      from p, history_rounds(p_format, p_bow_type, p_date_from, p_date_to, p_distances) r
      cross join lateral (
        select coalesce(sum(s.score_int), 0) as total
        from distances d
        join shots s on s.distance_id = d.id
        where d.round_id = r.id
          and d.disabled_at is null
          and s.disabled_at is null
      ) t
      where (p_score_min is null or t.total >= p_score_min)
        and (p_score_max is null or t.total <= p_score_max)
    ),
    origin as (
      select
        r.id,
        r.round_date,
        r.created_at,
        (case when p.by_score then t.total else (r.round_date - date '2000-01-01')::numeric end) * p.dir as sort_val
      from p, rounds r
      cross join lateral (
        select coalesce(sum(s.score_int), 0) as total
        from distances d
        join shots s on s.distance_id = d.id
        where d.round_id = r.id
          and d.disabled_at is null
          and s.disabled_at is null
      ) t
      where r.id = p_after_id
    ),
    page as (
      select
        c.*,
        row_number() over (order by c.sort_val, c.round_date desc, c.created_at desc, c.id) as rn
      from candidates c
      left join origin o on true
      where p_after_id is null
        or (
          o.id is not null
          and (
            c.sort_val > o.sort_val
            or (c.sort_val = o.sort_val and c.round_date < o.round_date)
            or (c.sort_val = o.sort_val and c.round_date = o.round_date and c.created_at < o.created_at)
            or (c.sort_val = o.sort_val and c.round_date = o.round_date and c.created_at = o.created_at and c.id > o.id)
          )
        )
      order by rn
      limit p_limit + 1
    )
  select jsonb_build_object(
    'rounds', coalesce(
      jsonb_agg(
        jsonb_build_object('id', id, 'name', name, 'round_date', round_date, 'total', total)
        order by rn
      ) filter (where rn <= p_limit),
      '[]'::jsonb
    ),
    'has_more', count(*) > p_limit
  )
  from page;
$$;

-- 件は、history_roundsが返すラウンドの無効でない距離。射つ順の番号(number)は無効でない距離に(position_key, id)の順で振る。
-- 並びは、並べる値、実施日の新しい順、作成時刻の新しい順、ラウンドのIDの昇順、距離の(position_key, id)。起点は距離のIDで、距離の行と属するラウンドから条件に関わらず引く。
CREATE FUNCTION "public"."distances_list"("p_sort_key" "text", "p_sort_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date" DEFAULT NULL, "p_date_to" "date" DEFAULT NULL, "p_score_min" bigint DEFAULT NULL, "p_score_max" bigint DEFAULT NULL, "p_distances" jsonb DEFAULT NULL, "p_distance" jsonb DEFAULT NULL) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY INVOKER
    SET "search_path" TO 'public'
    AS $$
  with
    p as (
      select
        case when p_sort_direction = 'asc' then 1 else -1 end as dir,
        coalesce(p_sort_key = 'score', false) as by_score
    ),
    candidates as (
      select
        d.id,
        r.id as round_id,
        r.name,
        r.round_date,
        r.created_at,
        d.position_key,
        d.n as number,
        d.distance,
        d.is_marked,
        t.total,
        (case when p.by_score then t.total else (r.round_date - date '2000-01-01')::numeric end) * p.dir as sort_val
      from p, history_rounds(p_format, p_bow_type, p_date_from, p_date_to, p_distances) r
      cross join lateral (
        select dd.*, row_number() over (order by dd.position_key, dd.id) as n
        from distances dd
        where dd.round_id = r.id
          and dd.disabled_at is null
      ) d
      cross join lateral (
        select coalesce(sum(s.score_int), 0) as total
        from shots s
        where s.distance_id = d.id
          and s.disabled_at is null
      ) t
      where (p_score_min is null or t.total >= p_score_min)
        and (p_score_max is null or t.total <= p_score_max)
        and (p_distance is null or coalesce(
          d.is_marked
          and d.distance = (p_distance->>'distance')::bigint
          and (p_distance->>'arrows_per_end' is null or d.arrows_per_end = (p_distance->>'arrows_per_end')::bigint)
          and (p_distance->>'total_arrows' is null or d.total_ends * d.arrows_per_end = (p_distance->>'total_arrows')::bigint)
          and (p_distance->>'target_face_id' is null or d.target_face_id = (p_distance->>'target_face_id')::uuid),
          false))
    ),
    origin as (
      select
        d.id,
        d.position_key,
        r.id as round_id,
        r.round_date,
        r.created_at,
        (case when p.by_score then t.total else (r.round_date - date '2000-01-01')::numeric end) * p.dir as sort_val
      from p, distances d
      join rounds r on r.id = d.round_id
      cross join lateral (
        select coalesce(sum(s.score_int), 0) as total
        from shots s
        where s.distance_id = d.id
          and s.disabled_at is null
      ) t
      where d.id = p_after_id
    ),
    page as (
      select
        c.*,
        row_number() over (order by c.sort_val, c.round_date desc, c.created_at desc, c.round_id, c.position_key, c.id) as rn
      from candidates c
      left join origin o on true
      where p_after_id is null
        or (
          o.id is not null
          and (
            c.sort_val > o.sort_val
            or (c.sort_val = o.sort_val and c.round_date < o.round_date)
            or (c.sort_val = o.sort_val and c.round_date = o.round_date and c.created_at < o.created_at)
            or (c.sort_val = o.sort_val and c.round_date = o.round_date and c.created_at = o.created_at and c.round_id > o.round_id)
            or (c.sort_val = o.sort_val and c.round_date = o.round_date and c.created_at = o.created_at and c.round_id = o.round_id and c.position_key > o.position_key)
            or (c.sort_val = o.sort_val and c.round_date = o.round_date and c.created_at = o.created_at and c.round_id = o.round_id and c.position_key = o.position_key and c.id > o.id)
          )
        )
      order by rn
      limit p_limit + 1
    )
  select jsonb_build_object(
    'distances', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'round_id', round_id,
          'name', name,
          'round_date', round_date,
          'number', number,
          'distance', distance,
          'is_marked', is_marked,
          'total', total
        )
        order by rn
      ) filter (where rn <= p_limit),
      '[]'::jsonb
    ),
    'has_more', count(*) > p_limit
  )
  from page;
$$;

ALTER FUNCTION "public"."distances_list"("p_sort_key" "text", "p_sort_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date", "p_date_to" "date", "p_score_min" bigint, "p_score_max" bigint, "p_distances" jsonb, "p_distance" jsonb) OWNER TO "postgres";

REVOKE EXECUTE ON FUNCTION "public"."distances_list"("p_sort_key" "text", "p_sort_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date", "p_date_to" "date", "p_score_min" bigint, "p_score_max" bigint, "p_distances" jsonb, "p_distance" jsonb) FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."distances_list"("p_sort_key" "text", "p_sort_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date", "p_date_to" "date", "p_score_min" bigint, "p_score_max" bigint, "p_distances" jsonb, "p_distance" jsonb) TO "authenticated";

commit;
