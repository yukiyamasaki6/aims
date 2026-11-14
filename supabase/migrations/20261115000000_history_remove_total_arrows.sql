-- 履歴の絞り込みから矢の総数(total_arrows)を廃止する。署名・戻り値・並び・所有者・実行権限は変えない。
--   - history_roundsとdistances_listの本文から、行の鍵total_arrowsと、総エンド数×1エンドの矢数との比較を除く(CREATE OR REPLACE)
--   - rounds_listはhistory_roundsを呼ぶだけで、本文は変えない
--   - 旧い版の端末がtotal_arrowsを送っても、鍵は読まれず無視され、エラーにならない(絞り込みが広がるだけ)
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

CREATE OR REPLACE FUNCTION "public"."distances_list"("p_date_direction" "text", "p_score_direction" "text", "p_format" "text", "p_bow_type" "text", "p_after_id" "uuid", "p_limit" integer, "p_date_from" "date" DEFAULT NULL, "p_date_to" "date" DEFAULT NULL, "p_score_min" bigint DEFAULT NULL, "p_score_max" bigint DEFAULT NULL, "p_distances" jsonb DEFAULT NULL, "p_distance" jsonb DEFAULT NULL) RETURNS "jsonb"
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

commit;
