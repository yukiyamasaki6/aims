-- 履歴の取得の関数rounds_listを足す。
--   - 完了した(status = 'completed')削除されていないラウンドを、条件で絞り、並べて、1ページずつ返す
--   - 続きの起点は直前のページの最後のラウンドのID。並びの値(実施日、作成時刻、合計点)はIDの行から引く(キーセット)
--   - 合計点は、無効でない距離の無効でない矢のscore_intの総和で、矢が無ければ0
--   - SECURITY INVOKERの読み取り専用で、認可はSELECTのRLS(select_if_member)に従う。引数は検証しない

begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- 並び: 基準(p_sort_keyが'score'なら合計点、それ以外は実施日)をp_sort_directionの向き('asc'以外は降順)、実施日の新しい順、作成時刻の新しい順、IDの昇順。
-- p_format、p_bow_type: nullは指定なし。p_after_id: nullは先頭のページ。起点の行が見えないときは0件で続きなし。
-- p_limit件を超える行があれば has_more を真にし、p_limit件だけ返す。
-- 戻り値: {"rounds": [{"id", "name", "round_date", "total"}], "has_more": boolean}
CREATE OR REPLACE FUNCTION "public"."rounds_list"("p_sort_key" "text", "p_sort_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer) RETURNS "jsonb"
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

ALTER FUNCTION "public"."rounds_list"("p_sort_key" "text", "p_sort_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer) OWNER TO "postgres";

REVOKE EXECUTE ON FUNCTION "public"."rounds_list"("p_sort_key" "text", "p_sort_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer) FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."rounds_list"("p_sort_key" "text", "p_sort_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer) TO "authenticated";

commit;
