-- 主キーの付け替えと列の削除は、表の書き換えを伴い、1つのトランザクションで原子的に行う必要がある。
-- 書き込みの停止は`lock_timeout`で上限を付ける。移行の間、旧い版の端末の書き込みは契約の不一致で破棄される(docs/features/rounds/sync/design.md)。
-- squawk-ignore-file ban-drop-column, adding-not-nullable-field, constraint-missing-not-valid, disallowed-unique-constraint, require-concurrent-index-deletion, adding-serial-primary-key-field, prefer-robust-stmts
-- トランザクション制御(begin/commit)は書かない(squawkの`prefer-robust-stmts`は上で無視する)。適用はCLIが1ファイルを1トランザクションで行い、pgTAPは自身のトランザクションの中で`\i`で実行して巻き戻せる。
set lock_timeout = '1s';
set statement_timeout = '30s';

-- 矢の記録をマス(distance_id, end_number, shot_number)で識別する形へ変える。
-- 生きている矢にエンドごとの射順を振り、取り消し済みの矢と履歴を消し、生きている矢の履歴をマスへ付け替える。

-- 0. 旧shot_numberの一意索引を先に消す。旧い射順が、振る番号と一時的に重なっても止まらないようにする。
drop index public.shots_live_end_idx;
drop index public.shots_live_shot_number_key;

-- 1. 生きている矢へ射順を振る。点数の高い順(X、10、9、…、1、M)、同点は旧idの昇順。旧shot_numberは使わない。
with ranked as (
  select
    id,
    row_number() over (
      partition by distance_id, end_number
      order by
        case
          when score_str = 'M' then -1::numeric
          when score_str = 'X' then score_int + 0.5
          else score_int::numeric
        end desc,
        id asc
    ) as rn
  from public.shots
  where disabled_at is null
)
update public.shots s
set shot_number = ranked.rn
from ranked
where s.id = ranked.id;

-- 2. 取り消し済みの矢の行と、その矢の履歴を消す。
delete from public.shot_events
where shot_id not in (select id from public.shots where disabled_at is null);

delete from public.shots
where disabled_at is not null;

-- 3. 生きている矢の履歴を、旧shot_idの代わりにマスで指す。
update public.shot_events e
set
  shot_number = s.shot_number,
  set_fields = array_remove(e.set_fields, 'shot_number')
from public.shots s
where s.id = e.shot_id;

-- 4. 制約と索引を新しい形にする。
alter table public.shot_events drop constraint shot_events_shot_id_revision_key;
alter table public.shot_events drop column shot_id;
alter table public.shot_events alter column shot_number set not null;
alter table public.shot_events
  add constraint shot_events_cell_revision_key unique (distance_id, end_number, shot_number, revision);

alter table public.shots drop constraint shots_pkey;
alter table public.shots drop column id;
alter table public.shots alter column shot_number set not null;
alter table public.shots add constraint shots_pkey primary key (distance_id, end_number, shot_number);

-- 5. RPCを新しい契約で作り直す。
create or replace function public.shot_fits(
  p_target_face_id uuid, p_total_ends bigint, p_arrows_per_end bigint, p_end bigint, p_shot_number bigint,
  p_score_str text, p_score_int bigint
) returns boolean
language sql stable
set search_path to 'public'
as $$
  select p_end between 1 and p_total_ends
    and p_shot_number between 1 and p_arrows_per_end
    and (
      (p_score_str = 'M' and p_score_int = 0)
      or exists (
        select 1
        from target_face_spots sp
        join target_face_rings r on r.spot_id = sp.id
        where sp.target_face_id = p_target_face_id
          and r.score_str = p_score_str
          and r.score_int = p_score_int
      )
    )
$$;

create or replace function public.record_shots(p_shots jsonb) returns jsonb
language plpgsql security definer
set search_path to 'public'
as $_$
declare
  v_shot jsonb;
  v_distance_id uuid;
  v_round_id uuid;
  v_round_disabled_at timestamptz;
  v_distance_disabled_at timestamptz;
  v_total_ends bigint;
  v_arrows_per_end bigint;
  v_target_face_id uuid;
  v_end bigint;
  v_shot_number bigint;
  v_score_str text;
  v_score_int bigint;
  v_has_shooter boolean;
  v_shooter_id uuid;
  v_row shots%rowtype;
  v_row_found boolean;
  v_applied text[];
  v_keys text[];
  v_new_revision bigint;
  v_event_revision bigint;
  v_event_set_fields text[];
  v_results jsonb := '[]'::jsonb;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  -- 契約の検証。マス(end_number、shot_number)の無い要素と旧い形(shot_id)の要素は拒否する。
  if p_shots is null or jsonb_typeof(p_shots) <> 'array' or jsonb_array_length(p_shots) > 100 then
    raise exception '矢の記録は100件以下の配列で指定してください。' using errcode = 'PT422';
  end if;
  for v_shot in select * from jsonb_array_elements(p_shots)
  loop
    if jsonb_typeof(v_shot) <> 'object'
      or coalesce(jsonb_typeof(v_shot -> 'distance_id'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'shot_event_id'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'end_number'), '') <> 'number'
      or coalesce(jsonb_typeof(v_shot -> 'shot_number'), '') <> 'number'
      or coalesce(jsonb_typeof(v_shot -> 'score_str'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'score_int'), '') <> 'number'
      or coalesce((v_shot ->> 'distance_id') !~ v_uuid_re, true)
      or coalesce((v_shot ->> 'shot_event_id') !~ v_uuid_re, true)
      or coalesce((v_shot #>> '{end_number}') !~ '^[1-9][0-9]{0,15}$', true)
      or coalesce((v_shot #>> '{shot_number}') !~ '^[1-9][0-9]{0,15}$', true)
      or coalesce((v_shot #>> '{score_int}') !~ '^-?[0-9]{1,15}$', true)
      or (v_shot ->> 'score_str') = ''
      or (
        v_shot ? 'shooter_id'
        and (jsonb_typeof(v_shot -> 'shooter_id') <> 'string' or coalesce((v_shot ->> 'shooter_id') !~ v_uuid_re, true))
      ) then
      raise exception '矢の記録の指定が不正です。' using errcode = 'PT422';
    end if;
  end loop;

  -- バッチ内のdistanceをロックする。送信器の要求は距離ごとの1件だけで、ID順にはしない。
  -- 存在しない距離は、要素ごとにMISSINGとして返す。
  for v_distance_id in
    select distinct (shot ->> 'distance_id')::uuid
    from jsonb_array_elements(p_shots) as shot
  loop
    v_round_id := null;
    select d.round_id into v_round_id
    from distances d
    where d.id = v_distance_id
    for update;

    if v_round_id is not null and not is_round_editor(v_round_id) then
      raise exception 'この距離に矢を記録する権限がありません。' using errcode = 'PT403';
    end if;
  end loop;

  for v_shot in select * from jsonb_array_elements(p_shots)
  loop
    v_distance_id := (v_shot ->> 'distance_id')::uuid;
    v_end := (v_shot ->> 'end_number')::bigint;
    v_shot_number := (v_shot ->> 'shot_number')::bigint;
    v_score_str := v_shot ->> 'score_str';
    v_score_int := (v_shot ->> 'score_int')::bigint;
    v_has_shooter := v_shot ? 'shooter_id';

    select d.round_id, d.disabled_at, d.total_ends, d.arrows_per_end, d.target_face_id, r.disabled_at
      into v_round_id, v_distance_disabled_at, v_total_ends, v_arrows_per_end, v_target_face_id, v_round_disabled_at
    from distances d
    join rounds r on r.id = d.round_id
    where d.id = v_distance_id;

    if not found then
      v_results := v_results || jsonb_build_object(
        'revision', null::bigint, 'applied', false, 'applied_fields', null::text[],
        'rejected_fields', '[]'::jsonb, 'reason', 'MISSING'
      );
      continue;
    end if;

    -- 効いた操作の再送は、記録した属性を効いた項目として返す。要素にあって記録に無い属性はREJECTEDとする。
    select revision, set_fields into v_event_revision, v_event_set_fields
    from shot_events where event_id = (v_shot ->> 'shot_event_id')::uuid;
    if found then
      v_applied := coalesce(v_event_set_fields, array['score', 'shooter_id']);
      v_keys := array['score'];
      if v_has_shooter then
        v_keys := array_append(v_keys, 'shooter_id');
      end if;
      v_results := v_results || jsonb_build_object(
        'revision', v_event_revision,
        'applied', true,
        'applied_fields', to_jsonb(v_applied),
        'rejected_fields', (
          select coalesce(jsonb_agg(jsonb_build_object('field', k, 'reason', 'REJECTED')), '[]'::jsonb)
          from unnest(v_keys) k
          where k <> all (v_applied)
        ),
        'reason', null::text
      );
      continue;
    end if;

    -- shooter_idは「誰の代理で記録するか」を選ぶだけであり、権限自体は上のis_round_editor()で判定済みなので、
    -- author_idに相当する実行者情報がクライアント入力に左右されることはない。
    if v_has_shooter then
      v_shooter_id := (v_shot ->> 'shooter_id')::uuid;
      if not exists (
        select 1 from round_users
        where round_id = v_round_id and user_id = v_shooter_id
      ) then
        raise exception '指定された射手はこのラウンドのメンバーではありません。' using errcode = 'PT403';
      end if;
    end if;

    if v_round_disabled_at is not null or v_distance_disabled_at is not null then
      v_results := v_results || jsonb_build_object(
        'revision', null::bigint, 'applied', false, 'applied_fields', null::text[],
        'rejected_fields', '[]'::jsonb, 'reason', 'DISABLED'
      );
      continue;
    end if;

    -- 現在の構成に収まらないマス・点数は効かせない。射数/エンドの上限は、この範囲の判定と主キーで守る。
    if not shot_fits(v_target_face_id, v_total_ends, v_arrows_per_end, v_end, v_shot_number, v_score_str, v_score_int) then
      v_results := v_results || jsonb_build_object(
        'revision', null::bigint, 'applied', false, 'applied_fields', null::text[],
        'rejected_fields', '[]'::jsonb, 'reason', 'UNFIT'
      );
      continue;
    end if;

    select * into v_row from shots
    where distance_id = v_distance_id and end_number = v_end and shot_number = v_shot_number;
    v_row_found := found;

    -- 行の無いマスでは射手を必ず決めるため、射手は効いた属性になる。
    v_applied := array['score'];
    if v_has_shooter or not v_row_found then
      v_applied := array_append(v_applied, 'shooter_id');
    end if;

    if not v_has_shooter then
      v_shooter_id := case when v_row_found then v_row.shooter_id else auth.uid() end;
    end if;

    -- マスの履歴と射影の両方のrevisionを見て採番する。
    select greatest(
      (select max(e.revision) from shot_events e
        where e.distance_id = v_distance_id and e.end_number = v_end and e.shot_number = v_shot_number),
      (select s.revision from shots s
        where s.distance_id = v_distance_id and s.end_number = v_end and s.shot_number = v_shot_number),
      0
    ) + 1 into v_new_revision;

    insert into shot_events (
      event_id, distance_id, end_number, shot_number, type, author_id, revision,
      shooter_id, score_str, score_int, set_fields
    )
    values (
      (v_shot ->> 'shot_event_id')::uuid, v_distance_id, v_end, v_shot_number, 'RECORDED', auth.uid(), v_new_revision,
      v_shooter_id, v_score_str, v_score_int, v_applied
    );

    if v_row_found then
      update shots
      set
        score_str = v_score_str,
        score_int = v_score_int,
        shooter_id = v_shooter_id,
        revision = v_new_revision,
        disabled_at = null
      where distance_id = v_distance_id and end_number = v_end and shot_number = v_shot_number;
    else
      insert into shots (distance_id, end_number, shot_number, shooter_id, score_str, score_int, revision)
      values (v_distance_id, v_end, v_shot_number, v_shooter_id, v_score_str, v_score_int, v_new_revision);
    end if;

    v_results := v_results || jsonb_build_object(
      'revision', v_new_revision, 'applied', true, 'applied_fields', to_jsonb(v_applied),
      'rejected_fields', '[]'::jsonb, 'reason', null::text
    );
  end loop;

  return v_results;
end;
$_$;

create or replace function public.clear_shots(p_shots jsonb) returns jsonb
language plpgsql security definer
set search_path to 'public'
as $_$
declare
  v_shot jsonb;
  v_distance_id uuid;
  v_round_id uuid;
  v_round_disabled_at timestamptz;
  v_distance_disabled_at timestamptz;
  v_end bigint;
  v_shot_number bigint;
  v_row_disabled_at timestamptz;
  v_new_revision bigint;
  v_event_revision bigint;
  v_results jsonb := '[]'::jsonb;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  -- 契約の検証。マス(end_number、shot_number)の無い要素と旧い形(shot_id)の要素は拒否する。
  if p_shots is null or jsonb_typeof(p_shots) <> 'array' or jsonb_array_length(p_shots) > 100 then
    raise exception '矢の取り消しは100件以下の配列で指定してください。' using errcode = 'PT422';
  end if;
  for v_shot in select * from jsonb_array_elements(p_shots)
  loop
    if jsonb_typeof(v_shot) <> 'object'
      or coalesce(jsonb_typeof(v_shot -> 'distance_id'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'shot_event_id'), '') <> 'string'
      or coalesce(jsonb_typeof(v_shot -> 'end_number'), '') <> 'number'
      or coalesce(jsonb_typeof(v_shot -> 'shot_number'), '') <> 'number'
      or coalesce((v_shot ->> 'distance_id') !~ v_uuid_re, true)
      or coalesce((v_shot ->> 'shot_event_id') !~ v_uuid_re, true)
      or coalesce((v_shot #>> '{end_number}') !~ '^[1-9][0-9]{0,15}$', true)
      or coalesce((v_shot #>> '{shot_number}') !~ '^[1-9][0-9]{0,15}$', true) then
      raise exception '矢の取り消しの指定が不正です。' using errcode = 'PT422';
    end if;
  end loop;

  -- 得点の記録・取消と距離構成の変更を、distanceの行ロックで同じ直列化境界に置く。
  -- 送信器の要求は距離ごとの1件だけで、複数の距離を逆順で処理する別クライアントは無いため、ID順にはしない。
  for v_distance_id in
    select distinct (shot ->> 'distance_id')::uuid
    from jsonb_array_elements(p_shots) as shot
  loop
    v_round_id := null;
    select d.round_id into v_round_id
    from distances d
    where d.id = v_distance_id
    for update;

    if v_round_id is not null and not is_round_editor(v_round_id) then
      raise exception 'この距離の矢を取り消す権限がありません。' using errcode = 'PT403';
    end if;
  end loop;

  for v_shot in select * from jsonb_array_elements(p_shots)
  loop
    v_distance_id := (v_shot ->> 'distance_id')::uuid;
    v_end := (v_shot ->> 'end_number')::bigint;
    v_shot_number := (v_shot ->> 'shot_number')::bigint;

    select d.round_id, d.disabled_at, r.disabled_at
      into v_round_id, v_distance_disabled_at, v_round_disabled_at
    from distances d
    join rounds r on r.id = d.round_id
    where d.id = v_distance_id;

    if not found then
      v_results := v_results || jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'MISSING');
      continue;
    end if;

    select revision into v_event_revision from shot_events where event_id = (v_shot ->> 'shot_event_id')::uuid;
    if found then
      v_results := v_results || jsonb_build_object('revision', v_event_revision, 'applied', true, 'reason', null::text);
      continue;
    end if;

    if v_round_disabled_at is not null or v_distance_disabled_at is not null then
      v_results := v_results || jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'DISABLED');
      continue;
    end if;

    select disabled_at into v_row_disabled_at from shots
    where distance_id = v_distance_id and end_number = v_end and shot_number = v_shot_number;
    if not found then
      v_results := v_results || jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'MISSING');
      continue;
    end if;

    -- 消えているマスを別の操作IDで消す要求は、書かずに効かない結果で返す(履歴に同じ消去を並べない)。
    if v_row_disabled_at is not null then
      v_results := v_results || jsonb_build_object('revision', null::bigint, 'applied', false, 'reason', 'DISABLED');
      continue;
    end if;

    select greatest(
      (select max(e.revision) from shot_events e
        where e.distance_id = v_distance_id and e.end_number = v_end and e.shot_number = v_shot_number),
      (select s.revision from shots s
        where s.distance_id = v_distance_id and s.end_number = v_end and s.shot_number = v_shot_number),
      0
    ) + 1 into v_new_revision;

    insert into shot_events (event_id, distance_id, end_number, shot_number, type, author_id, revision)
    values (
      (v_shot ->> 'shot_event_id')::uuid, v_distance_id, v_end, v_shot_number, 'CLEARED', auth.uid(), v_new_revision
    );

    update shots
    set disabled_at = clock_timestamp(), revision = v_new_revision
    where distance_id = v_distance_id and end_number = v_end and shot_number = v_shot_number;

    v_results := v_results || jsonb_build_object('revision', v_new_revision, 'applied', true, 'reason', null::text);
  end loop;

  return v_results;
end;
$_$;

create or replace function "public"."update_distance"("p_distance_event_id" "uuid", "p_distance_id" "uuid", "p_changes" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_round_id uuid;
  v_format text;
  v_round_disabled_at timestamptz;
  v_revision bigint;
  v_distance_disabled_at timestamptz;
  v_distance bigint;
  v_is_marked boolean;
  v_total_ends bigint;
  v_arrows_per_end bigint;
  v_target_face_id uuid;
  v_event_revision bigint;
  v_set_fields text[];
  v_keys text[];
  v_applied text[] := '{}';
  v_rejected jsonb := '[]'::jsonb;
  v_new_distance bigint;
  v_new_is_marked boolean;
  v_new_total_ends bigint;
  v_new_arrows_per_end bigint;
  v_new_target_face_id uuid;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  select round_id into v_round_id
  from distances
  where id = p_distance_id;

  -- 対象が存在しない（効かなかった距離の追加の後続）操作は、拒否せず、効かないと返す。
  -- 距離IDは端末が作る推測できないUUIDで、存在しないことだけを返すため、他のラウンドの情報は漏れない。
  if v_round_id is null then
    return jsonb_build_object(
      'revision', null::bigint, 'applied', false, 'applied_fields', null::text[],
      'rejected_fields', '[]'::jsonb, 'reason', 'MISSING'
    );
  end if;

  -- formatとis_markedの組合せを変える全RPCは親rounds行を先にロックする。
  select format, disabled_at into v_format, v_round_disabled_at
  from rounds
  where id = v_round_id
  for update;

  -- 得点の記録・取消も同じdistance行をロックするため、構成の変更と矢の記録を直列化する。
  select revision, disabled_at, distance, is_marked, total_ends, arrows_per_end, target_face_id
    into v_revision, v_distance_disabled_at, v_distance, v_is_marked, v_total_ends, v_arrows_per_end, v_target_face_id
  from distances
  where id = p_distance_id
  for update;

  if not is_round_editor(v_round_id) then
    raise exception 'この距離を編集する権限がありません。' using errcode = 'PT403';
  end if;

  select revision, set_fields into v_event_revision, v_set_fields
  from distance_events where event_id = p_distance_event_id;
  if found then
    -- 記録した項目を、差分のキー（構成の3項目はconfig）へ戻して返す。
    v_applied := coalesce(v_set_fields, array['distance', 'is_marked', 'total_ends', 'arrows_per_end', 'target_face_id']);
    v_applied := array(
      select k from unnest(array['distance', 'is_marked', 'config']) k
      where k = any (v_applied) or (k = 'config' and v_applied && array['total_ends', 'arrows_per_end', 'target_face_id'])
    );
    if jsonb_typeof(p_changes) = 'object' then
      select coalesce(array_agg(k), '{}') into v_keys from jsonb_object_keys(p_changes) k;
    else
      v_keys := '{}';
    end if;
    return jsonb_build_object(
      'revision', v_event_revision,
      'applied', true,
      'applied_fields', to_jsonb(v_applied),
      'rejected_fields', (
        select coalesce(jsonb_agg(jsonb_build_object('field', k, 'reason', 'REJECTED')), '[]'::jsonb)
        from unnest(v_keys) k
        where k <> all (v_applied)
      ),
      'reason', null::text
    );
  end if;

  -- 契約の検証
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception '距離の変更はキーを持つオブジェクトで指定してください。' using errcode = 'PT422';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_changes) k
    where k not in ('distance', 'is_marked', 'config')
  ) then
    raise exception '距離の変更に未知の項目が含まれています。' using errcode = 'PT422';
  end if;
  if p_changes ? 'distance' and jsonb_typeof(p_changes -> 'distance') <> 'null' and (
    jsonb_typeof(p_changes -> 'distance') <> 'number' or (p_changes #>> '{distance}') !~ '^[1-9][0-9]{0,15}$'
  ) then
    raise exception '距離(m)が不正です。' using errcode = 'PT422';
  end if;
  if p_changes ? 'distance' and distance_config_over_limit((p_changes #>> '{distance}')::numeric, null, null) then
    raise exception '距離・総エンド数・矢数が上限を超えています。' using errcode = 'PT422';
  end if;
  if p_changes ? 'is_marked' and jsonb_typeof(p_changes -> 'is_marked') <> 'boolean' then
    raise exception 'Marked/Unmarkedが不正です。' using errcode = 'PT422';
  end if;
  if p_changes ? 'config' then
    if jsonb_typeof(p_changes -> 'config') <> 'object'
      or (select count(*) from jsonb_object_keys(p_changes -> 'config')) <> 3
      or not ((p_changes -> 'config') ?& array['total_ends', 'arrows_per_end', 'target_face_id']) then
      raise exception '構成は的・エンド数・矢数の3項目で指定してください。' using errcode = 'PT422';
    end if;
    if jsonb_typeof(p_changes -> 'config' -> 'total_ends') <> 'number'
      or (p_changes #>> '{config,total_ends}') !~ '^[1-9][0-9]{0,15}$'
      or jsonb_typeof(p_changes -> 'config' -> 'arrows_per_end') <> 'number'
      or (p_changes #>> '{config,arrows_per_end}') !~ '^[1-9][0-9]{0,15}$'
      or jsonb_typeof(p_changes -> 'config' -> 'target_face_id') <> 'string'
      or (p_changes #>> '{config,target_face_id}') !~ v_uuid_re then
      raise exception '構成の値が不正です。' using errcode = 'PT422';
    end if;
    if distance_config_over_limit(
      null, (p_changes #>> '{config,total_ends}')::numeric, (p_changes #>> '{config,arrows_per_end}')::numeric
    ) then
      raise exception '距離・総エンド数・矢数が上限を超えています。' using errcode = 'PT422';
    end if;
    v_new_total_ends := (p_changes #>> '{config,total_ends}')::bigint;
    v_new_arrows_per_end := (p_changes #>> '{config,arrows_per_end}')::bigint;
    v_new_target_face_id := (p_changes #>> '{config,target_face_id}')::uuid;
    if not exists (select 1 from target_faces where id = v_new_target_face_id) then
      raise exception '指定された的が存在しません。' using errcode = 'PT422';
    end if;
  end if;
  if (p_changes -> 'is_marked') = 'true'::jsonb and (p_changes -> 'distance') = 'null'::jsonb then
    raise exception 'Markedにする変更と距離(m)の未設定を同時に指定できません。' using errcode = 'PT422';
  end if;

  -- 規則の判定: 削除済みのラウンド・距離は全項目が効かない。
  if v_round_disabled_at is not null or v_distance_disabled_at is not null then
    return jsonb_build_object(
      'revision', null::bigint, 'applied', false, 'applied_fields', null::text[],
      'rejected_fields', '[]'::jsonb, 'reason', 'DISABLED'
    );
  end if;

  -- Marked/Unmarkedを距離(m)より先に判定する。同じ操作の項目は同じ確定の順序なので、Markedの判定には同じ操作の距離(m)(保存後の値)を使う。
  -- 距離(m)を空にする変更は、Markedと同時には上のPT422で弾いている。
  if p_changes ? 'is_marked' then
    v_new_is_marked := (p_changes ->> 'is_marked')::boolean;
    if (not v_new_is_marked and v_format <> 'field')
      or (v_new_is_marked and (case when p_changes ? 'distance' then (p_changes #>> '{distance}')::bigint else v_distance end) is null) then
      v_rejected := v_rejected || jsonb_build_object('field', 'is_marked', 'reason', 'INVARIANT');
    else
      v_applied := array_append(v_applied, 'is_marked');
      v_is_marked := v_new_is_marked;
    end if;
  end if;

  if p_changes ? 'distance' then
    v_new_distance := (p_changes #>> '{distance}')::bigint;
    if v_new_distance is null and v_is_marked then
      v_rejected := v_rejected || jsonb_build_object('field', 'distance', 'reason', 'INVARIANT');
    else
      v_applied := array_append(v_applied, 'distance');
      v_distance := v_new_distance;
    end if;
  end if;

  if p_changes ? 'config' then
    -- 射数/エンドの上限は、各矢が新しい範囲のマスにあることで守る(マスごとに1行)。
    if exists (
      select 1 from shots s
      where s.distance_id = p_distance_id
        and s.disabled_at is null
        and not shot_fits(v_new_target_face_id, v_new_total_ends, v_new_arrows_per_end, s.end_number, s.shot_number, s.score_str, s.score_int)
    ) then
      v_rejected := v_rejected || jsonb_build_object('field', 'config', 'reason', 'UNFIT');
    else
      v_applied := array_append(v_applied, 'config');
    end if;
  end if;

  if cardinality(v_applied) = 0 then
    return jsonb_build_object(
      'revision', null::bigint, 'applied', false, 'applied_fields', '[]'::jsonb,
      'rejected_fields', v_rejected, 'reason', null::text
    );
  end if;

  insert into distance_events (
    event_id, round_id, distance_id, type, author_id, revision, set_fields,
    position_key, distance, is_marked, total_ends, arrows_per_end, target_face_id
  )
  select
    p_distance_event_id, v_round_id, p_distance_id, 'UPDATED', auth.uid(), v_revision + 1,
    array(
      select f from unnest(array['distance', 'is_marked', 'total_ends', 'arrows_per_end', 'target_face_id']) f
      where (f = 'distance' and 'distance' = any (v_applied))
        or (f = 'is_marked' and 'is_marked' = any (v_applied))
        or (f in ('total_ends', 'arrows_per_end', 'target_face_id') and 'config' = any (v_applied))
    ),
    position_key,
    case when 'distance' = any (v_applied) then v_distance end,
    case when 'is_marked' = any (v_applied) then v_is_marked end,
    case when 'config' = any (v_applied) then v_new_total_ends end,
    case when 'config' = any (v_applied) then v_new_arrows_per_end end,
    case when 'config' = any (v_applied) then v_new_target_face_id end
  from distances where id = p_distance_id;

  update distances
  set
    distance = case when 'distance' = any (v_applied) then v_distance else distance end,
    is_marked = case when 'is_marked' = any (v_applied) then v_is_marked else is_marked end,
    total_ends = case when 'config' = any (v_applied) then v_new_total_ends else total_ends end,
    arrows_per_end = case when 'config' = any (v_applied) then v_new_arrows_per_end else arrows_per_end end,
    target_face_id = case when 'config' = any (v_applied) then v_new_target_face_id else target_face_id end,
    revision = v_revision + 1
  where id = p_distance_id;

  return jsonb_build_object(
    'revision', v_revision + 1, 'applied', true, 'applied_fields', to_jsonb(v_applied),
    'rejected_fields', v_rejected, 'reason', null::text
  );
end;
$_$;
