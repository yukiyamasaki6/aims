-- 履歴の関数rounds_listに、期間(p_date_from、p_date_to)と得点の範囲(p_score_min、p_score_max)の絞り込みを足す。
--   - 引数の追加は署名を変え、CREATE OR REPLACEでは多重定義になり6引数の呼び出しが曖昧になるため、旧署名をDROPして作り直す
--   - 新しい引数は末尾で既定値null(指定なし)。旧い版の6引数の呼び出しは、絞り込みなしと同じ結果で動く
--   - 期間は実施日が開始日以上・終了日以下、得点の範囲は合計点が下限以上・上限以下(境界を含む)。続きの起点の行は条件に関わらずIDから引く
--   - 所有者と実行権限(authenticatedだけ)も付け直す。引数は検証しない

begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

DROP FUNCTION "public"."rounds_list"("p_sort_key" "text", "p_sort_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer);

-- 並び・戻り値・起点は20261112000000_rounds_list.sqlと同じ。
CREATE OR REPLACE FUNCTION "public"."rounds_list"("p_sort_key" "text", "p_sort_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date" DEFAULT NULL, "p_date_to" "date" DEFAULT NULL, "p_score_min" bigint DEFAULT NULL, "p_score_max" bigint DEFAULT NULL) RETURNS "jsonb"
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

ALTER FUNCTION "public"."rounds_list"("p_sort_key" "text", "p_sort_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date", "p_date_to" "date", "p_score_min" bigint, "p_score_max" bigint) OWNER TO "postgres";

REVOKE EXECUTE ON FUNCTION "public"."rounds_list"("p_sort_key" "text", "p_sort_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date", "p_date_to" "date", "p_score_min" bigint, "p_score_max" bigint) FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."rounds_list"("p_sort_key" "text", "p_sort_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date", "p_date_to" "date", "p_score_min" bigint, "p_score_max" bigint) TO "authenticated";

commit;
