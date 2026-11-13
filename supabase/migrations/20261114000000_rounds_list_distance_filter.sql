-- 履歴の関数rounds_listに、距離の構成(p_distances)の絞り込みを足す。
--   - 引数の追加は署名を変え、CREATE OR REPLACEでは多重定義になり旧い呼び出しが曖昧になるため、旧署名(10引数)をDROPして作り直す
--   - 新しい引数は末尾で既定値null(指定なし)。旧い版の6引数・10引数の呼び出しは、絞り込みなしと同じ結果で動く
--   - p_distancesは射つ順の行の配列[{distance, arrows_per_end, total_arrows, target_face_id}]で、指定のない項目はnull(鍵が無くてもnull)
--   - 距離の構成は、無効でない距離を(position_key, id)の順に並べた行が、指定と同じ個数で、先頭から順に各行が一致すること。距離が判明していて(is_marked)距離が等しく、指定のある項目(1エンドの矢数、矢の総数(total_ends x arrows_per_end)、的)も等しい行を一致とする。距離が0件のラウンドは一致しない
--   - 所有者と実行権限(authenticatedだけ)も付け直す。引数は検証しない

begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

DROP FUNCTION "public"."rounds_list"("p_sort_key" "text", "p_sort_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date", "p_date_to" "date", "p_score_min" bigint, "p_score_max" bigint);

-- 並び・戻り値・起点は20261113000000_rounds_list_range_filters.sqlと同じ。
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
      from p, rounds r
      cross join lateral (
        select coalesce(sum(s.score_int), 0) as total
        from distances d
        join shots s on s.distance_id = d.id
        where d.round_id = r.id
          and d.disabled_at is null
          and s.disabled_at is null
      ) t
      where r.disabled_at is null
        and r.status = 'completed'
        and (p_format is null or r.format = p_format)
        and (p_bow_type is null or r.bow_type = p_bow_type)
        and (p_date_from is null or r.round_date >= p_date_from)
        and (p_date_to is null or r.round_date <= p_date_to)
        and (p_score_min is null or t.total >= p_score_min)
        and (p_score_max is null or t.total <= p_score_max)
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
            from distances dd
            where dd.round_id = r.id
              and dd.disabled_at is null
          ) d
          left join jsonb_array_elements(p_distances) with ordinality as c(value, n) on c.n = d.n
        ), false))
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

ALTER FUNCTION "public"."rounds_list"("p_sort_key" "text", "p_sort_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date", "p_date_to" "date", "p_score_min" bigint, "p_score_max" bigint, "p_distances" jsonb) OWNER TO "postgres";

REVOKE EXECUTE ON FUNCTION "public"."rounds_list"("p_sort_key" "text", "p_sort_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date", "p_date_to" "date", "p_score_min" bigint, "p_score_max" bigint, "p_distances" jsonb) FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."rounds_list"("p_sort_key" "text", "p_sort_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date", "p_date_to" "date", "p_score_min" bigint, "p_score_max" bigint, "p_distances" jsonb) TO "authenticated";

commit;
