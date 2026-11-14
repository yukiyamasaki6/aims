-- 履歴の取得(rounds_list)を効率化する。結果は変えない。
--   - 索引: distances(round_id)、round_users(user_id)。距離・所属を引く索引が無く、RLSの判定と集計が全件の走査になっていた
--   - ポリシー: distancesのselect_if_memberを「見えるroundsがあること」、shotsのselect_if_memberを「見えるdistancesがあること」の判定に置き換える。親の表のRLSが所属を判定するため、読める行は変わらない(外部キーで親は必ずある)。矢1行ごとのis_round_member呼び出しが減る
--   - rounds_list: candidatesの母集団を、所属(round_users.user_id = auth.uid())から引く形に変える。本文のそれ以外、署名・SECURITY INVOKER・権限は変えない
--   - 戻すときは、逆の内容の追加のmigrationで行う

begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- CONCURRENTLYはトランザクションの中で使えず、索引・ポリシー・関数を原子的に適用するため使わない。
-- 書き込みの停止はlock_timeoutで上限を付け、作成時間は合成データで数十ミリ秒だった。
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX "distances_round_id_idx" ON "public"."distances" USING "btree" ("round_id");
-- 同上。
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX "round_users_user_id_idx" ON "public"."round_users" USING "btree" ("user_id");

ALTER POLICY "select_if_member" ON "public"."distances" USING (EXISTS (SELECT 1 FROM "public"."rounds" "r" WHERE "r"."id" = "distances"."round_id"));

ALTER POLICY "select_if_member" ON "public"."shots" USING (EXISTS (SELECT 1 FROM "public"."distances" "d" WHERE "d"."id" = "shots"."distance_id"));

-- 並び・戻り値・起点は20261114000000_rounds_list_distance_filter.sqlと同じ。candidatesの母集団だけを所属から引く。
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
      from p, round_users ru join rounds r on r.id = ru.round_id
      cross join lateral (
        select coalesce(sum(s.score_int), 0) as total
        from distances d
        join shots s on s.distance_id = d.id
        where d.round_id = r.id
          and d.disabled_at is null
          and s.disabled_at is null
      ) t
      where ru.user_id = auth.uid()
        and r.disabled_at is null
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

commit;
