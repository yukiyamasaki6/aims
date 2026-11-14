-- 履歴の並べ替えの引数を、基準と向き(p_sort_key、p_sort_direction)から、日付の向きと得点の向き(p_date_direction、p_score_direction)に差し替える。history_roundsは変えない。
--   - 引数の名前を変えるため、rounds_listとdistances_listの旧署名をDROPして新署名を作り直す。引数の位置と型、戻り値、SECURITY INVOKER、search_pathは変えず、所有者と実行権限(authenticatedだけ)を付け直す
--   - p_date_direction: 'asc'以外は降順。p_score_direction: 'asc'・'desc'以外(NULLを含む)は指定なし
--   - 並べる値は第1キーv1と第2キーv2。得点の向きがあるとき、v1は合計点×向き、v2は実施日×日付の向き。得点の向きがないとき、v1は実施日×日付の向き、v2は0
--   - 並びは、v1、v2、作成時刻の新しい順、ID(距離単位はさらにラウンドのID、射つ順)の昇順。起点との比較も同じ鍵で行う
--   - 旧い条件(date, d)は(日付の向きd, 指定なし)、(score, d)は(日付の向き降順, 得点の向きd)で、並びとページの境界は変わらない
--   - 旧い版の端末の旧署名の呼び出しは、DBに旧署名がないためエラーになる(許容)
--   - 戻すときは、逆の内容の追加のmigrationで行う

begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

DROP FUNCTION "public"."rounds_list"("p_sort_key" "text", "p_sort_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date", "p_date_to" "date", "p_score_min" bigint, "p_score_max" bigint, "p_distances" jsonb);
DROP FUNCTION "public"."distances_list"("p_sort_key" "text", "p_sort_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date", "p_date_to" "date", "p_score_min" bigint, "p_score_max" bigint, "p_distances" jsonb, "p_distance" jsonb);

-- 並び・戻り値・起点はhistory_roundsを読む20261114000200_distances_list.sqlのrounds_listと、並べる値だけが異なる。
CREATE FUNCTION "public"."rounds_list"("p_date_direction" "text", "p_score_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date" DEFAULT NULL, "p_date_to" "date" DEFAULT NULL, "p_score_min" bigint DEFAULT NULL, "p_score_max" bigint DEFAULT NULL, "p_distances" jsonb DEFAULT NULL) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY INVOKER
    SET "search_path" TO 'public'
    AS $$
  with
    p as (
      select
        case when p_date_direction = 'asc' then 1 else -1 end as date_dir,
        case p_score_direction when 'asc' then 1 when 'desc' then -1 end as score_dir
    ),
    candidates as (
      select
        r.id,
        r.name,
        r.round_date,
        r.created_at,
        t.total,
        case when p.score_dir is not null then t.total * p.score_dir else (r.round_date - date '2000-01-01')::numeric * p.date_dir end as v1,
        case when p.score_dir is not null then (r.round_date - date '2000-01-01')::numeric * p.date_dir else 0 end as v2
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
        case when p.score_dir is not null then t.total * p.score_dir else (r.round_date - date '2000-01-01')::numeric * p.date_dir end as v1,
        case when p.score_dir is not null then (r.round_date - date '2000-01-01')::numeric * p.date_dir else 0 end as v2
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
        row_number() over (order by c.v1, c.v2, c.created_at desc, c.id) as rn
      from candidates c
      left join origin o on true
      where p_after_id is null
        or (
          o.id is not null
          and (
            (c.v1, c.v2) > (o.v1, o.v2)
            or (c.v1 = o.v1 and c.v2 = o.v2 and c.created_at < o.created_at)
            or (c.v1 = o.v1 and c.v2 = o.v2 and c.created_at = o.created_at and c.id > o.id)
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

ALTER FUNCTION "public"."rounds_list"("p_date_direction" "text", "p_score_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date", "p_date_to" "date", "p_score_min" bigint, "p_score_max" bigint, "p_distances" jsonb) OWNER TO "postgres";

REVOKE EXECUTE ON FUNCTION "public"."rounds_list"("p_date_direction" "text", "p_score_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date", "p_date_to" "date", "p_score_min" bigint, "p_score_max" bigint, "p_distances" jsonb) FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."rounds_list"("p_date_direction" "text", "p_score_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date", "p_date_to" "date", "p_score_min" bigint, "p_score_max" bigint, "p_distances" jsonb) TO "authenticated";

-- 件・並び・起点の対象はrounds_listと同じ並べる値で、距離を1件ずつにする(並びは、v1、v2、作成時刻の新しい順、ラウンドのIDの昇順、距離の(position_key, id))。
CREATE FUNCTION "public"."distances_list"("p_date_direction" "text", "p_score_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date" DEFAULT NULL, "p_date_to" "date" DEFAULT NULL, "p_score_min" bigint DEFAULT NULL, "p_score_max" bigint DEFAULT NULL, "p_distances" jsonb DEFAULT NULL, "p_distance" jsonb DEFAULT NULL) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY INVOKER
    SET "search_path" TO 'public'
    AS $$
  with
    p as (
      select
        case when p_date_direction = 'asc' then 1 else -1 end as date_dir,
        case p_score_direction when 'asc' then 1 when 'desc' then -1 end as score_dir
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
        case when p.score_dir is not null then t.total * p.score_dir else (r.round_date - date '2000-01-01')::numeric * p.date_dir end as v1,
        case when p.score_dir is not null then (r.round_date - date '2000-01-01')::numeric * p.date_dir else 0 end as v2
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
        case when p.score_dir is not null then t.total * p.score_dir else (r.round_date - date '2000-01-01')::numeric * p.date_dir end as v1,
        case when p.score_dir is not null then (r.round_date - date '2000-01-01')::numeric * p.date_dir else 0 end as v2
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
        row_number() over (order by c.v1, c.v2, c.created_at desc, c.round_id, c.position_key, c.id) as rn
      from candidates c
      left join origin o on true
      where p_after_id is null
        or (
          o.id is not null
          and (
            (c.v1, c.v2) > (o.v1, o.v2)
            or (c.v1 = o.v1 and c.v2 = o.v2 and c.created_at < o.created_at)
            or (c.v1 = o.v1 and c.v2 = o.v2 and c.created_at = o.created_at and c.round_id > o.round_id)
            or (c.v1 = o.v1 and c.v2 = o.v2 and c.created_at = o.created_at and c.round_id = o.round_id and c.position_key > o.position_key)
            or (c.v1 = o.v1 and c.v2 = o.v2 and c.created_at = o.created_at and c.round_id = o.round_id and c.position_key = o.position_key and c.id > o.id)
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

ALTER FUNCTION "public"."distances_list"("p_date_direction" "text", "p_score_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date", "p_date_to" "date", "p_score_min" bigint, "p_score_max" bigint, "p_distances" jsonb, "p_distance" jsonb) OWNER TO "postgres";

REVOKE EXECUTE ON FUNCTION "public"."distances_list"("p_date_direction" "text", "p_score_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date", "p_date_to" "date", "p_score_min" bigint, "p_score_max" bigint, "p_distances" jsonb, "p_distance" jsonb) FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."distances_list"("p_date_direction" "text", "p_score_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date", "p_date_to" "date", "p_score_min" bigint, "p_score_max" bigint, "p_distances" jsonb, "p_distance" jsonb) TO "authenticated";

commit;
