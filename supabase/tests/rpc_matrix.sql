-- RPCの「RPC × 観点 × アクター」マトリクステスト。
-- 現在の挙動を期待値表として固定し、RPCの変更を表の差分として見えるようにする。
-- 個別のデータの振る舞い（イベントの順序、射影、CASCADEなど）は rounds.sql で確認し、このファイルは全体の一覧性と網羅性を担う。
--
-- 観点
--   success: 正常系。権限のある実行者が有効な入力で呼ぶ
--   unauthorized: 権限なし。ラウンドのメンバーでないか、viewerが呼ぶ
--   invalid: 不正・無効な入力。権限のある実行者が、拒否される入力（契約の不一致はPT422）、または効かない入力（応答のreasonで返し、何も記録しない）で呼ぶ
--   idempotent: 冪等性。同じevent_idで2回呼び、2回目も成功してイベントもrevisionも増えない
--     save_round_as_presetはevent_idを持たないため、同じ入力の重複保存の扱いを固定する
-- アクター
--   editor / viewer: 対象ラウンドのメンバー
--   non_member: 対象ラウンドのメンバーではない認証済みユーザー
--   anonの実行拒否は rls_matrix.sql の関数EXECUTE表が固定済みのため、ここでは扱わない
--
-- 実測は 'ok' か 'error:<メッセージ>' に正規化し、呼び出し後の状態（イベント件数、revision、射影の値）と併せて期待値表と比較する。
-- 拒否はPT403（認可）とPT422（契約の不一致）を、'error:[PT403]<メッセージ>' のようにSQLSTATE付きで固定する。それ以外はメッセージで区別する。
-- 成功した呼び出しは、戻り値の要約（効いたか、効いた項目、効かなかった項目と理由）を状態の末尾に付けて固定する。
-- 拒否された呼び出しの状態は、サブトランザクションの巻き戻し後に測る。RPCが例外にせず黙って成功した場合は、状態の変化として検出される。
-- 該当しない組み合わせは、理由を付けて n/a として明示する。

begin;

select plan(11);

-- ============================================================
-- fixture
-- ============================================================
-- 識別子は別名で扱う。呼び出しSQLと期待値では '@R1' のように別名で参照し、q() が実際のuuidへ置き換える。
--   E/V/N: editor・viewer・非メンバーのユーザー
--   R1/R2: outdoorのラウンドとfieldのラウンド（editor・viewerがメンバー）
--   D1: R1の距離（得点なし）、D2: R1の距離（得点2件）、D3: R2のUnmarkedの距離（得点1件）
--   RN/DN/DN2: 作成系RPCが新規に作るラウンド・距離。DEV/DEV2はその初期距離のイベントID
--   EV1〜EV3: 呼び出しごとのevent_id。ケースは巻き戻されるため、ケース間で使い回せる
--   F1/F2: シードの的。UNKNOWN: どこにも存在しないID
create temp table rpc_id (alias text primary key, id uuid not null);
insert into rpc_id (alias, id) values
  ('E',       'c0000000-0000-0000-0000-000000000001'),
  ('V',       'c0000000-0000-0000-0000-000000000002'),
  ('N',       'c0000000-0000-0000-0000-000000000003'),
  ('R1',      'c0000000-0000-0000-0000-000000000010'),
  ('R2',      'c0000000-0000-0000-0000-000000000011'),
  ('D1',      'c0000000-0000-0000-0000-000000000021'),
  ('D2',      'c0000000-0000-0000-0000-000000000022'),
  ('D3',      'c0000000-0000-0000-0000-000000000023'),
  ('RN',      'c0000000-0000-0000-0000-000000000030'),
  ('DN',      'c0000000-0000-0000-0000-000000000040'),
  ('DN2',     'c0000000-0000-0000-0000-000000000041'),
  ('EV1',     'c0000000-0000-0000-0000-0000000000e1'),
  ('EV2',     'c0000000-0000-0000-0000-0000000000e2'),
  ('EV3',     'c0000000-0000-0000-0000-0000000000e3'),
  ('DEV',     'c0000000-0000-0000-0000-0000000000d1'),
  ('DEV2',    'c0000000-0000-0000-0000-0000000000d2'),
  ('F1',      'a1000000-0000-0000-0000-000000000001'),
  ('F2',      'a1000000-0000-0000-0000-000000000002'),
  ('UNKNOWN', 'c0000000-0000-0000-0000-0000000000ff');

create function pg_temp.id(p_alias text) returns uuid
language sql stable
as $$ select id from rpc_id where alias = p_alias $$;

insert into auth.users (id) values (pg_temp.id('E')), (pg_temp.id('V')), (pg_temp.id('N'));

-- 既存の状態はイベントログと射影を揃えて、RPCを経由せず接続ロールで直接INSERTする。
insert into public.rounds (id, name, round_date, format, bow_type) values
  (pg_temp.id('R1'), 'Matrix Outdoor', '2026-01-01', 'outdoor', 'recurve'),
  (pg_temp.id('R2'), 'Matrix Field', '2026-01-01', 'field', 'recurve');

insert into public.round_users (round_id, user_id, role) values
  (pg_temp.id('R1'), pg_temp.id('E'), 'editor'),
  (pg_temp.id('R1'), pg_temp.id('V'), 'viewer'),
  (pg_temp.id('R2'), pg_temp.id('E'), 'editor'),
  (pg_temp.id('R2'), pg_temp.id('V'), 'viewer');

insert into public.round_events (event_id, round_id, type, author_id, revision, name, round_date, format, bow_type) values
  ('c0000000-0000-0000-0000-00000000f001', pg_temp.id('R1'), 'CREATED', pg_temp.id('E'), 1, 'Matrix Outdoor', '2026-01-01', 'outdoor', 'recurve'),
  ('c0000000-0000-0000-0000-00000000f002', pg_temp.id('R2'), 'CREATED', pg_temp.id('E'), 1, 'Matrix Field', '2026-01-01', 'field', 'recurve');

insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked) values
  (pg_temp.id('D1'), pg_temp.id('R1'), 'a', 70, 6, 6, pg_temp.id('F1'), true),
  (pg_temp.id('D2'), pg_temp.id('R1'), 'b', 50, 6, 6, pg_temp.id('F1'), true),
  (pg_temp.id('D3'), pg_temp.id('R2'), 'a', null, 6, 6, pg_temp.id('F1'), false);

insert into public.distance_events (event_id, round_id, distance_id, type, author_id, revision, position_key, distance, is_marked, total_ends, arrows_per_end, target_face_id) values
  ('c0000000-0000-0000-0000-00000000f011', pg_temp.id('R1'), pg_temp.id('D1'), 'CREATED', pg_temp.id('E'), 1, 'a', 70, true, 6, 6, pg_temp.id('F1')),
  ('c0000000-0000-0000-0000-00000000f012', pg_temp.id('R1'), pg_temp.id('D2'), 'CREATED', pg_temp.id('E'), 1, 'b', 50, true, 6, 6, pg_temp.id('F1')),
  ('c0000000-0000-0000-0000-00000000f013', pg_temp.id('R2'), pg_temp.id('D3'), 'CREATED', pg_temp.id('E'), 1, 'a', null, false, 6, 6, pg_temp.id('F1'));

insert into public.shots (distance_id, end_number, arrow_number, shooter_id, score_str, score_int) values
  (pg_temp.id('D2'), 1, 1, pg_temp.id('E'), 'X', 10),
  (pg_temp.id('D2'), 1, 2, pg_temp.id('E'), '9', 9),
  (pg_temp.id('D3'), 1, 1, pg_temp.id('E'), '9', 9);

insert into public.shot_events (event_id, distance_id, type, author_id, revision, end_number, arrow_number, shooter_id, score_str, score_int) values
  ('c0000000-0000-0000-0000-00000000f021', pg_temp.id('D2'), 'RECORDED', pg_temp.id('E'), 1, 1, 1, pg_temp.id('E'), 'X', 10),
  ('c0000000-0000-0000-0000-00000000f022', pg_temp.id('D2'), 'RECORDED', pg_temp.id('E'), 1, 1, 2, pg_temp.id('E'), '9', 9),
  ('c0000000-0000-0000-0000-00000000f023', pg_temp.id('D3'), 'RECORDED', pg_temp.id('E'), 1, 1, 1, pg_temp.id('E'), '9', 9);

-- ============================================================
-- 共通ヘルパー
-- ============================================================

create temp table rpc_actor (actor text primary key, alias text not null references rpc_id);
insert into rpc_actor (actor, alias) values ('editor', 'E'), ('viewer', 'V'), ('non_member', 'N');

-- 別名 '@R1' を実際のuuidへ置き換える。長い別名から置換し、'@EV1' が '@E' に誤って一致しないようにする。
create function pg_temp.resolve(p_text text) returns text
language plpgsql stable
as $$
declare
  v_text text := p_text;
  v_row record;
begin
  for v_row in select alias, id from rpc_id order by length(alias) desc loop
    v_text := replace(v_text, '@' || v_row.alias, v_row.id::text);
  end loop;
  return v_text;
end;
$$;

-- RPCごとの有効な既定の引数。element は配列引数の要素の既定値で、q() が上書きの各要素へ重ねる。
create temp table rpc_default (fn text primary key, args jsonb not null, element jsonb not null default '{}');
insert into rpc_default (fn, args, element) values
  ('create_round',
    '{"p_round_event_id":"@EV1","p_id":"@RN","p_name":"Matrix New Round","p_round_date":"2026-01-01","p_format":"outdoor","p_bow_type":"recurve","p_distances":[{}]}',
    '{"p_distances":{"distance_event_id":"@DEV","id":"@DN","position_key":"a","distance":70,"is_marked":true,"total_ends":6,"arrows_per_end":6,"target_face_id":"@F1"}}'),
  ('update_round',
    '{"p_round_event_id":"@EV1","p_round_id":"@R1","p_changes":{"name":"Renamed Round","round_date":"2026-02-02","format":"indoor","bow_type":"compound"}}',
    '{}'),
  ('create_distance',
    '{"p_distance_event_id":"@EV1","p_id":"@DN","p_round_id":"@R1","p_position_key":"c","p_distance":30,"p_total_ends":4,"p_arrows_per_end":3,"p_target_face_id":"@F2","p_is_marked":true}',
    '{}'),
  ('update_distance',
    '{"p_distance_event_id":"@EV1","p_distance_id":"@D1","p_changes":{"distance":55,"config":{"total_ends":3,"arrows_per_end":3,"target_face_id":"@F2"}}}',
    '{}'),
  ('disable_round', '{"p_round_event_id":"@EV1","p_round_id":"@R1"}', '{}'),
  ('disable_distance', '{"p_distance_event_id":"@EV1","p_distance_id":"@D1"}', '{}'),
  ('record_shots',
    '{"p_shots":[{}]}',
    '{"p_shots":{"shot_event_id":"@EV1","distance_id":"@D1","end_number":1,"arrow_number":1,"score_str":"9","score_int":9}}'),
  ('clear_shots',
    '{"p_shots":[{}]}',
    '{"p_shots":{"shot_event_id":"@EV1","distance_id":"@D2","end_number":1,"arrow_number":1}}'),
  ('save_round_as_preset',
    '{"p_name":"Matrix Preset","p_format":"field","p_bow_type":"compound","p_distances":[{},{"position_key":"b","distance":null,"is_marked":false,"total_ends":4}]}',
    '{"p_distances":{"position_key":"a","distance":50,"is_marked":true,"total_ends":6,"arrows_per_end":6,"target_face_id":"@F1"}}');

-- RPCの呼び出しSQLを組み立てる。p_over で既定の引数を上書きし、配列引数は要素ごとに既定の要素へ重ねる。
-- 値のnullは、必須項目の欠落としてNULLのまま渡す。
create function pg_temp.q(p_fn text, p_over jsonb default '{}') returns text
language plpgsql stable
as $$
declare
  v_def rpc_default;
  v_args jsonb;
  v_key text;
  v_val jsonb;
begin
  select * into strict v_def from rpc_default where fn = p_fn;
  v_args := v_def.args;
  v_args := v_args || p_over;
  for v_key, v_val in select * from jsonb_each(v_def.element) loop
    -- 配列でない上書き(契約の不一致の変異)は、重ねずそのまま渡す。
    continue when jsonb_typeof(v_args -> v_key) is distinct from 'array';
    v_args := v_args || jsonb_build_object(v_key, (
      select coalesce(jsonb_agg(v_val || e order by o), '[]')
      from jsonb_array_elements(v_args -> v_key) with ordinality as t(e, o)
    ));
  end loop;
  return pg_temp.resolve((
    select format('select %s(%s)', p_fn, string_agg(format('%s => %L', a.key, a.value), ', ' order by a.key))
    from jsonb_each_text(v_args) as a
  ));
end;
$$;

-- 状態の測定。呼び出し後の接続ロール（RLS対象外）で、イベントログと射影を読む。
create function pg_temp.st_round(p_alias text) returns text
language sql stable
as $$
  select coalesce((
    select format('events=%s revision=%s name=%s date=%s format=%s bow=%s disabled=%s',
      (select count(*) from round_events where round_id = r.id),
      r.revision, r.name, r.round_date, r.format, r.bow_type, (r.disabled_at is not null)::text)
    from rounds r where r.id = pg_temp.id(p_alias)
  ), 'round=absent')
$$;

create function pg_temp.st_distance(p_alias text) returns text
language sql stable
as $$
  select coalesce((
    select format('events=%s revision=%s distance=%s ends=%s arrows=%s face=%s marked=%s disabled=%s',
      (select count(*) from distance_events where distance_id = d.id),
      d.revision, coalesce(d.distance::text, '-'), d.total_ends, d.arrows_per_end, right(d.target_face_id::text, 4),
      d.is_marked::text, (d.disabled_at is not null)::text)
    from distances d where d.id = pg_temp.id(p_alias)
  ), 'distance=absent')
$$;

-- 作成系RPCは、対象が存在しない状態も件数として表す。
create function pg_temp.st_new_distance(p_alias text) returns text
language sql stable
as $$
  select format('distances=%s distance_events=%s revision=%s position=%s distance=%s ends=%s arrows=%s face=%s marked=%s',
    count(d.id),
    (select count(*) from distance_events where distance_id = pg_temp.id(p_alias)),
    coalesce(max(d.revision)::text, '-'), coalesce(max(d.position_key), '-'), coalesce(max(d.distance)::text, '-'),
    coalesce(max(d.total_ends)::text, '-'), coalesce(max(d.arrows_per_end)::text, '-'),
    coalesce(right(max(d.target_face_id::text), 4), '-'), coalesce(bool_or(d.is_marked)::text, '-'))
  from distances d where d.id = pg_temp.id(p_alias)
$$;

-- p_returned はRPCの戻り値。create_roundは、クライアントが生成したラウンドIDをそのまま返す。
-- 距離は 位置:距離:Marked:エンド数x矢数:的の末尾4桁:IDの末尾2桁 で表し、クライアント生成のIDが保存されることも見る。
create function pg_temp.st_create_round(p_returned text) returns text
language sql stable
as $$
  select format('returned=%s round=[%s] rounds=%s round_events=%s editors=%s distances=%s distance_events=%s list=[%s]',
    coalesce(p_returned = pg_temp.id('RN')::text, false)::text,
    coalesce((select format('%s/%s/%s/%s', name, round_date, format, bow_type) from rounds where id = pg_temp.id('RN')), '-'),
    (select count(*) from rounds where id = pg_temp.id('RN')),
    (select count(*) from round_events where round_id = pg_temp.id('RN')),
    (select count(*) from round_users where round_id = pg_temp.id('RN') and user_id = pg_temp.id('E') and role = 'editor'),
    (select count(*) from distances where round_id = pg_temp.id('RN')),
    (select count(*) from distance_events where round_id = pg_temp.id('RN')),
    coalesce((
      select string_agg(
        format('%s:%s:%s:%sx%s:%s:%s', position_key, coalesce(distance::text, '-'), is_marked::text,
          total_ends, arrows_per_end, right(target_face_id::text, 4), right(id::text, 2)),
        ' ' order by position_key)
      from distances where round_id = pg_temp.id('RN')
    ), ''))
$$;

create function pg_temp.st_shots(p_alias text) returns text
language sql stable
as $$
  select format('events=%s shots=[%s]',
    (select count(*) from shot_events where distance_id = pg_temp.id(p_alias)),
    coalesce((
      select string_agg(
        format('%s-%s:%s/%s/r%s%s', s.end_number, s.arrow_number, s.score_str, coalesce(a.actor, '?'), s.revision,
          case when s.disabled_at is not null then '/cleared' else '' end),
        ' ' order by s.end_number, s.arrow_number)
      from shots s
      left join rpc_actor a on pg_temp.id(a.alias) = s.shooter_id
      where s.distance_id = pg_temp.id(p_alias)
    ), ''))
$$;

-- プリセットは名前で特定する。ラウンドと紐付かないため、所有者と内容だけを見る。
-- 距離は 位置:距離:Marked:エンド数x矢数:的の末尾4桁 で表す。同じ内容の重複保存は、件数と行数で区別する。
create function pg_temp.st_preset(p_name text) returns text
language sql stable
as $$
  select format('presets=%s owner=%s format=%s bow=%s distance_rows=%s distances=[%s]',
    count(p.id),
    coalesce(string_agg(distinct a.actor, ','), '-'),
    coalesce(min(p.format), '-'), coalesce(min(p.bow_type), '-'),
    (select count(*) from preset_distances pd join preset_rounds pr on pr.id = pd.preset_id where pr.name = p_name),
    coalesce((
      select string_agg(distinct format('%s:%s:%s:%sx%s:%s', pd.position_key, coalesce(pd.distance::text, '-'), pd.is_marked::text,
          pd.total_ends, pd.arrows_per_end, right(pd.target_face_id::text, 4)),
        ' ' order by format('%s:%s:%s:%sx%s:%s', pd.position_key, coalesce(pd.distance::text, '-'), pd.is_marked::text,
          pd.total_ends, pd.arrows_per_end, right(pd.target_face_id::text, 4)))
      from preset_distances pd join preset_rounds pr on pr.id = pd.preset_id where pr.name = p_name
    ), ''))
  from preset_rounds p
  left join rpc_actor a on pg_temp.id(a.alias) = p.owner_id
  where p.name = p_name
$$;

-- RPCの戻り値の要約。配列は要素ごとの理由（効いた要素はapplied）、オブジェクトは効いたか、効いた項目、効かなかった項目と理由を表す。
create function pg_temp.res(p_returned text) returns text
language sql stable
as $$
  select case
    when p_returned is null then 'ret=-'
    when jsonb_typeof(p_returned::jsonb) = 'array' then
      'ret=[' || coalesce((
        select string_agg(coalesce(e ->> 'reason', case when (e ->> 'applied')::boolean then 'applied' else 'none' end), ',' order by o)
        from jsonb_array_elements(p_returned::jsonb) with ordinality as t(e, o)
      ), '') || ']'
    else
      'ret=' || coalesce(p_returned::jsonb ->> 'reason', case when (p_returned::jsonb ->> 'applied')::boolean then 'applied' else 'none' end)
        || coalesce(' fields=' || (select string_agg(f, ',') from jsonb_array_elements_text(case when jsonb_typeof(p_returned::jsonb -> 'applied_fields') = 'array' then p_returned::jsonb -> 'applied_fields' else '[]' end) f), '')
        || coalesce(' rejected=' || (select string_agg((r ->> 'field') || ':' || (r ->> 'reason'), ',') from jsonb_array_elements(p_returned::jsonb -> 'rejected_fields') r), '')
  end
$$;

-- 1ケースを指定アクターで実行し、'ok' か 'error:<メッセージ>' に正規化して、呼び出し後の状態と共に返す。
-- p_setup は事前状態を作る呼び出しで、同じアクターで実行する。p_repeat回呼ぶと同じ呼び出しの再送になる。
-- 状態を測るp_probeには、最後の呼び出しの戻り値を $1 で渡す。
-- 成功時も意図的な例外で巻き戻すため、ケースの副作用はfixtureに残らない。
create function pg_temp.rpc_run(
  p_actor text, p_setup text, p_call text, p_repeat int, p_probe text,
  out result text, out state text
)
language plpgsql
as $$
declare
  v_uid uuid;
  v_returned text;
  v_i int;
begin
  select pg_temp.id(alias) into strict v_uid from rpc_actor where actor = p_actor;
  begin
    perform set_config('request.jwt.claim.sub', v_uid::text, true);
    set local role authenticated;
    if p_setup is not null then
      execute p_setup;
    end if;
    for v_i in 1..p_repeat loop
      execute p_call into v_returned;
    end loop;
    reset role;
    execute p_probe into state using v_returned;
    result := 'ok';
    raise exception using errcode = 'ZZ001', message = 'rollback';
  exception
    when sqlstate 'ZZ001' then
      return;
    when others then
      result := 'error:' || case when sqlstate like 'PT%' then '[' || sqlstate || ']' else '' end || sqlerrm;
      execute p_probe into state using null::text;
      return;
  end;
end;
$$;

-- ============================================================
-- 呼び出し表: RPC × 観点 × 変種
-- ============================================================
-- 変種は、同じ観点の中で入力や対象の状態が異なるケース。同じ呼び出しを、期待値表のアクターごとに実行する。

create temp table rpc_call (
  rpc text, aspect text check (aspect in ('success', 'unauthorized', 'invalid', 'idempotent')), variant text,
  setup text, call text not null, repeat int not null default 1, probe text not null,
  primary key (rpc, aspect, variant)
);

insert into rpc_call (rpc, aspect, variant, setup, call, repeat, probe) values
  -- create_round
  ('create_round', 'success', 'default', null, pg_temp.q('create_round'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'success', 'field_unmarked', null, pg_temp.q('create_round', '{"p_format":"field","p_distances":[{"is_marked":false,"distance":null}]}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'success', 'empty_distances', null, pg_temp.q('create_round', '{"p_distances":[]}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'success', 'multi_distances', null, pg_temp.q('create_round', '{"p_distances":[{},{"id":"@DN2","distance_event_id":"@DEV2","position_key":"b","distance":50}]}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'success', 'name_50_chars', null, pg_temp.q('create_round', jsonb_build_object('p_name', repeat('a', 50))), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'missing_is_marked', null, pg_temp.q('create_round', '{"p_distances":[{"is_marked":null}]}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'unmarked_in_outdoor', null, pg_temp.q('create_round', '{"p_distances":[{"is_marked":false,"distance":null}]}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'invalid_format', null, pg_temp.q('create_round', '{"p_format":"invalid"}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'invalid_bow_type', null, pg_temp.q('create_round', '{"p_bow_type":"invalid"}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'name_51_chars', null, pg_temp.q('create_round', jsonb_build_object('p_name', repeat('a', 51))), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'missing_name', null, pg_temp.q('create_round', '{"p_name":null}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'missing_round_date', null, pg_temp.q('create_round', '{"p_round_date":null}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'missing_format', null, pg_temp.q('create_round', '{"p_format":null}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'missing_bow_type', null, pg_temp.q('create_round', '{"p_bow_type":null}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'missing_target_face', null, pg_temp.q('create_round', '{"p_distances":[{"target_face_id":null}]}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'missing_position_key', null, pg_temp.q('create_round', '{"p_distances":[{"position_key":null}]}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'marked_without_distance', null, pg_temp.q('create_round', '{"p_distances":[{"distance":null}]}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'total_ends_zero', null, pg_temp.q('create_round', '{"p_distances":[{"total_ends":0}]}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'unknown_target_face', null, pg_temp.q('create_round', '{"p_distances":[{"target_face_id":"@UNKNOWN"}]}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'existing_round_id', null, pg_temp.q('create_round', '{"p_id":"@R1"}'), 1, $$select pg_temp.st_round('R1')$$),
  ('create_round', 'unauthorized', 'replay_of_others_event', null, pg_temp.q('create_round', '{"p_round_event_id":"c0000000-0000-0000-0000-00000000f001"}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'event_id_of_update', pg_temp.q('update_round', '{"p_round_event_id":"@EV2","p_round_id":"@R1","p_changes":{"name":"Renamed"}}'), pg_temp.q('create_round', '{"p_round_event_id":"@EV2"}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'duplicate_distance_id', null, pg_temp.q('create_round', '{"p_distances":[{},{"distance_event_id":"@DEV2","position_key":"b"}]}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'duplicate_distance_event_id', null, pg_temp.q('create_round', '{"p_distances":[{},{"id":"@DN2","position_key":"b"}]}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'duplicate_position_key', null, pg_temp.q('create_round', '{"p_distances":[{},{"id":"@DN2","distance_event_id":"@DEV2"}]}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'existing_distance_id', null, pg_temp.q('create_round', '{"p_distances":[{"id":"@D1"}]}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'existing_distance_event_id', null, pg_temp.q('create_round', '{"p_distances":[{"distance_event_id":"c0000000-0000-0000-0000-00000000f011"}]}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'distances_not_array', null, pg_temp.q('create_round', '{"p_distances":{"a":1}}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'invalid_distance_id', null, pg_temp.q('create_round', '{"p_distances":[{"id":"not-a-uuid"}]}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'invalid', 'fractional_total_ends', null, pg_temp.q('create_round', '{"p_distances":[{"total_ends":1.5}]}'), 1, 'select pg_temp.st_create_round($1)'),
  ('create_round', 'idempotent', 'replay', null, pg_temp.q('create_round'), 2, 'select pg_temp.st_create_round($1)'),

  -- update_round
  ('update_round', 'success', 'default', null, pg_temp.q('update_round'), 1, $$select pg_temp.st_round('R1') || ' ' || pg_temp.res($1)$$),
  ('update_round', 'success', 'name_only', null, pg_temp.q('update_round', '{"p_round_id":"@R1","p_round_event_id":"@EV1","p_changes":{"name":"Only Name"}}'), 1, $$select pg_temp.st_round('R1') || ' ' || pg_temp.res($1)$$),
  ('update_round', 'success', 'field_with_unmarked', null, pg_temp.q('update_round', '{"p_round_id":"@R2","p_round_event_id":"@EV1","p_changes":{"name":"Field Renamed","format":"field","bow_type":"barebow"}}'), 1, $$select pg_temp.st_round('R2') || ' ' || pg_temp.res($1)$$),
  ('update_round', 'success', 'unmarked_resolved', pg_temp.q('update_distance', '{"p_distance_id":"@D3","p_distance_event_id":"@EV2","p_changes":{"distance":60}}') || '; ' || pg_temp.q('update_distance', '{"p_distance_id":"@D3","p_distance_event_id":"@EV3","p_changes":{"is_marked":true}}'), pg_temp.q('update_round', '{"p_round_id":"@R2","p_round_event_id":"@EV1","p_changes":{"name":"Outdoor Renamed","format":"outdoor","bow_type":"recurve"}}'), 1, $$select pg_temp.st_round('R2') || ' ' || pg_temp.res($1)$$),
  ('update_round', 'success', 'partial_invariant', null, pg_temp.q('update_round', '{"p_round_id":"@R2","p_round_event_id":"@EV1","p_changes":{"name":"Partly Renamed","format":"outdoor"}}'), 1, $$select pg_temp.st_round('R2') || ' ' || pg_temp.res($1)$$),
  ('update_round', 'unauthorized', 'default', null, pg_temp.q('update_round'), 1, $$select pg_temp.st_round('R1') || ' ' || pg_temp.res($1)$$),
  ('update_round', 'invalid', 'unmarked_remains', null, pg_temp.q('update_round', '{"p_round_id":"@R2","p_round_event_id":"@EV1","p_changes":{"format":"outdoor"}}'), 1, $$select pg_temp.st_round('R2') || ' ' || pg_temp.res($1)$$),
  ('update_round', 'invalid', 'round_disabled', pg_temp.q('disable_round', '{"p_round_event_id":"@EV2"}'), pg_temp.q('update_round'), 1, $$select pg_temp.st_round('R1') || ' ' || pg_temp.res($1)$$),
  ('update_round', 'invalid', 'unknown_round', null, pg_temp.q('update_round', '{"p_round_id":"@UNKNOWN","p_round_event_id":"@EV1","p_changes":{"name":"x"}}'), 1, $$select pg_temp.st_round('R1') || ' ' || pg_temp.res($1)$$),
  ('update_round', 'invalid', 'invalid_format', null, pg_temp.q('update_round', '{"p_round_id":"@R1","p_round_event_id":"@EV1","p_changes":{"format":"invalid"}}'), 1, $$select pg_temp.st_round('R1') || ' ' || pg_temp.res($1)$$),
  ('update_round', 'invalid', 'invalid_bow_type', null, pg_temp.q('update_round', '{"p_round_id":"@R1","p_round_event_id":"@EV1","p_changes":{"bow_type":"invalid"}}'), 1, $$select pg_temp.st_round('R1') || ' ' || pg_temp.res($1)$$),
  ('update_round', 'invalid', 'name_51_chars', null, pg_temp.q('update_round', jsonb_build_object('p_changes', jsonb_build_object('name', repeat('a', 51)))), 1, $$select pg_temp.st_round('R1') || ' ' || pg_temp.res($1)$$),
  ('update_round', 'invalid', 'missing_name', null, pg_temp.q('update_round', '{"p_round_id":"@R1","p_round_event_id":"@EV1","p_changes":{"name":null}}'), 1, $$select pg_temp.st_round('R1') || ' ' || pg_temp.res($1)$$),
  ('update_round', 'invalid', 'missing_round_date', null, pg_temp.q('update_round', '{"p_round_id":"@R1","p_round_event_id":"@EV1","p_changes":{"round_date":null}}'), 1, $$select pg_temp.st_round('R1') || ' ' || pg_temp.res($1)$$),
  ('update_round', 'invalid', 'missing_format', null, pg_temp.q('update_round', '{"p_round_id":"@R1","p_round_event_id":"@EV1","p_changes":{"format":null}}'), 1, $$select pg_temp.st_round('R1') || ' ' || pg_temp.res($1)$$),
  ('update_round', 'invalid', 'missing_bow_type', null, pg_temp.q('update_round', '{"p_round_id":"@R1","p_round_event_id":"@EV1","p_changes":{"bow_type":null}}'), 1, $$select pg_temp.st_round('R1') || ' ' || pg_temp.res($1)$$),
  ('update_round', 'invalid', 'invalid_round_date', null, pg_temp.q('update_round', '{"p_round_id":"@R1","p_round_event_id":"@EV1","p_changes":{"round_date":"2026-02-30"}}'), 1, $$select pg_temp.st_round('R1') || ' ' || pg_temp.res($1)$$),
  ('update_round', 'invalid', 'unknown_key', null, pg_temp.q('update_round', '{"p_round_id":"@R1","p_round_event_id":"@EV1","p_changes":{"unknown":1}}'), 1, $$select pg_temp.st_round('R1') || ' ' || pg_temp.res($1)$$),
  ('update_round', 'invalid', 'empty_changes', null, pg_temp.q('update_round', '{"p_round_id":"@R1","p_round_event_id":"@EV1","p_changes":{}}'), 1, $$select pg_temp.st_round('R1') || ' ' || pg_temp.res($1)$$),
  ('update_round', 'idempotent', 'replay', null, pg_temp.q('update_round'), 2, $$select pg_temp.st_round('R1') || ' ' || pg_temp.res($1)$$),
  ('update_round', 'idempotent', 'replay_partial', null, pg_temp.q('update_round', '{"p_round_id":"@R2","p_round_event_id":"@EV1","p_changes":{"name":"Partly Renamed","format":"outdoor"}}'), 2, $$select pg_temp.st_round('R2') || ' ' || pg_temp.res($1)$$),

  -- create_distance
  ('create_distance', 'success', 'default', null, pg_temp.q('create_distance'), 1, $$select pg_temp.st_new_distance('DN') || ' ' || pg_temp.res($1)$$),
  ('create_distance', 'success', 'unmarked_in_field', null, pg_temp.q('create_distance', '{"p_round_id":"@R2","p_distance":null,"p_is_marked":false}'), 1, $$select pg_temp.st_new_distance('DN') || ' ' || pg_temp.res($1)$$),
  ('create_distance', 'unauthorized', 'default', null, pg_temp.q('create_distance'), 1, $$select pg_temp.st_new_distance('DN') || ' ' || pg_temp.res($1)$$),
  ('create_distance', 'invalid', 'unmarked_in_outdoor', null, pg_temp.q('create_distance', '{"p_distance":null,"p_is_marked":false}'), 1, $$select pg_temp.st_new_distance('DN') || ' ' || pg_temp.res($1)$$),
  ('create_distance', 'invalid', 'round_disabled', pg_temp.q('disable_round', '{"p_round_event_id":"@EV2"}'), pg_temp.q('create_distance'), 1, $$select pg_temp.st_new_distance('DN') || ' ' || pg_temp.res($1)$$),
  ('create_distance', 'invalid', 'unknown_round', null, pg_temp.q('create_distance', '{"p_round_id":"@UNKNOWN"}'), 1, $$select pg_temp.st_new_distance('DN') || ' ' || pg_temp.res($1)$$),
  ('create_distance', 'invalid', 'missing_is_marked', null, pg_temp.q('create_distance', '{"p_is_marked":null}'), 1, $$select pg_temp.st_new_distance('DN') || ' ' || pg_temp.res($1)$$),
  ('create_distance', 'invalid', 'missing_target_face', null, pg_temp.q('create_distance', '{"p_target_face_id":null}'), 1, $$select pg_temp.st_new_distance('DN') || ' ' || pg_temp.res($1)$$),
  ('create_distance', 'invalid', 'missing_position_key', null, pg_temp.q('create_distance', '{"p_position_key":null}'), 1, $$select pg_temp.st_new_distance('DN') || ' ' || pg_temp.res($1)$$),
  ('create_distance', 'invalid', 'marked_without_distance', null, pg_temp.q('create_distance', '{"p_distance":null}'), 1, $$select pg_temp.st_new_distance('DN') || ' ' || pg_temp.res($1)$$),
  ('create_distance', 'invalid', 'total_ends_zero', null, pg_temp.q('create_distance', '{"p_total_ends":0}'), 1, $$select pg_temp.st_new_distance('DN') || ' ' || pg_temp.res($1)$$),
  ('create_distance', 'invalid', 'unknown_target_face', null, pg_temp.q('create_distance', '{"p_target_face_id":"@UNKNOWN"}'), 1, $$select pg_temp.st_new_distance('DN') || ' ' || pg_temp.res($1)$$),
  ('create_distance', 'invalid', 'existing_distance_id', null, pg_temp.q('create_distance', '{"p_id":"@D1"}'), 1, $$select pg_temp.st_new_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('create_distance', 'invalid', 'duplicate_position_key', null, pg_temp.q('create_distance', '{"p_position_key":"a"}'), 1, $$select pg_temp.st_new_distance('DN') || ' ' || pg_temp.res($1)$$),
  ('create_distance', 'idempotent', 'replay', null, pg_temp.q('create_distance'), 2, $$select pg_temp.st_new_distance('DN') || ' ' || pg_temp.res($1)$$),

  -- update_distance
  ('update_distance', 'success', 'default', null, pg_temp.q('update_distance'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'success', 'distance_only', null, pg_temp.q('update_distance', '{"p_distance_id":"@D1","p_distance_event_id":"@EV1","p_changes":{"distance":40}}'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'success', 'config_only', null, pg_temp.q('update_distance', '{"p_distance_id":"@D1","p_distance_event_id":"@EV1","p_changes":{"config":{"total_ends":3,"arrows_per_end":3,"target_face_id":"@F2"}}}'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'success', 'field_marked_to_unmarked', pg_temp.q('create_distance', '{"p_round_id":"@R2","p_id":"@DN"}'), pg_temp.q('update_distance', '{"p_distance_id":"@DN","p_distance_event_id":"@EV2","p_changes":{"is_marked":false,"distance":null}}'), 1, $$select pg_temp.st_distance('DN') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'success', 'with_shots_distance_only', null, pg_temp.q('update_distance', '{"p_distance_id":"@D2","p_distance_event_id":"@EV1","p_changes":{"distance":40}}'), 1, $$select pg_temp.st_distance('D2') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'success', 'with_shots_config_fits', null, pg_temp.q('update_distance', '{"p_distance_id":"@D2","p_distance_event_id":"@EV1","p_changes":{"config":{"total_ends":4,"arrows_per_end":6,"target_face_id":"@F2"}}}'), 1, $$select pg_temp.st_distance('D2') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'success', 'with_shots_unmarked_to_marked', pg_temp.q('update_distance', '{"p_distance_id":"@D3","p_distance_event_id":"@EV1","p_changes":{"distance":60}}'), pg_temp.q('update_distance', '{"p_distance_id":"@D3","p_distance_event_id":"@EV2","p_changes":{"is_marked":true}}'), 1, $$select pg_temp.st_distance('D3') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'success', 'with_shots_unmarked_stays', null, pg_temp.q('update_distance', '{"p_distance_id":"@D3","p_distance_event_id":"@EV1","p_changes":{"distance":45,"is_marked":false}}'), 1, $$select pg_temp.st_distance('D3') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'success', 'marked_with_distance_same_save', null, pg_temp.q('update_distance', '{"p_distance_id":"@D3","p_distance_event_id":"@EV1","p_changes":{"is_marked":true,"distance":60}}'), 1, $$select pg_temp.st_distance('D3') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'success', 'partial_config_unfit', null, pg_temp.q('update_distance', '{"p_distance_id":"@D2","p_distance_event_id":"@EV1","p_changes":{"distance":45,"config":{"total_ends":6,"arrows_per_end":1,"target_face_id":"@F1"}}}'), 1, $$select pg_temp.st_distance('D2') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'unauthorized', 'default', null, pg_temp.q('update_distance'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'invalid', 'unmarked_in_outdoor', null, pg_temp.q('update_distance', '{"p_distance_id":"@D1","p_distance_event_id":"@EV1","p_changes":{"is_marked":false}}'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'invalid', 'marked_distance_cleared', null, pg_temp.q('update_distance', '{"p_distance_id":"@D1","p_distance_event_id":"@EV1","p_changes":{"distance":null}}'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'invalid', 'with_shots_arrows_unfit', null, pg_temp.q('update_distance', '{"p_distance_id":"@D2","p_distance_event_id":"@EV1","p_changes":{"config":{"total_ends":6,"arrows_per_end":1,"target_face_id":"@F1"}}}'), 1, $$select pg_temp.st_distance('D2') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'invalid', 'with_shots_ends_unfit', pg_temp.q('record_shots', '{"p_shots":[{"distance_id":"@D2","shot_event_id":"@EV3","end_number":2,"arrow_number":1,"score_str":"9","score_int":9}]}'), pg_temp.q('update_distance', '{"p_distance_id":"@D2","p_distance_event_id":"@EV1","p_changes":{"config":{"total_ends":1,"arrows_per_end":1,"target_face_id":"@F1"}}}'), 1, $$select pg_temp.st_distance('D2') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'invalid', 'distance_disabled', pg_temp.q('disable_distance', '{"p_distance_event_id":"@EV2"}'), pg_temp.q('update_distance'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'invalid', 'unknown_distance', null, pg_temp.q('update_distance', '{"p_distance_id":"@UNKNOWN","p_distance_event_id":"@EV1","p_changes":{"distance":40}}'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'invalid', 'missing_is_marked', null, pg_temp.q('update_distance', '{"p_distance_id":"@D1","p_distance_event_id":"@EV1","p_changes":{"is_marked":null}}'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'invalid', 'marked_with_unset_distance', null, pg_temp.q('update_distance', '{"p_distance_id":"@D1","p_distance_event_id":"@EV1","p_changes":{"is_marked":true,"distance":null}}'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'invalid', 'config_missing_target_face', null, pg_temp.q('update_distance', '{"p_distance_id":"@D1","p_distance_event_id":"@EV1","p_changes":{"config":{"total_ends":3,"arrows_per_end":3}}}'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'invalid', 'config_target_face_null', null, pg_temp.q('update_distance', '{"p_distance_id":"@D1","p_distance_event_id":"@EV1","p_changes":{"config":{"total_ends":3,"arrows_per_end":3,"target_face_id":null}}}'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'invalid', 'total_ends_zero', null, pg_temp.q('update_distance', '{"p_distance_id":"@D1","p_distance_event_id":"@EV1","p_changes":{"config":{"total_ends":0,"arrows_per_end":3,"target_face_id":"@F1"}}}'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'invalid', 'unknown_target_face', null, pg_temp.q('update_distance', '{"p_distance_id":"@D1","p_distance_event_id":"@EV1","p_changes":{"config":{"total_ends":3,"arrows_per_end":3,"target_face_id":"@UNKNOWN"}}}'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'invalid', 'distance_zero', null, pg_temp.q('update_distance', '{"p_distance_id":"@D1","p_distance_event_id":"@EV1","p_changes":{"distance":0}}'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'invalid', 'unknown_key', null, pg_temp.q('update_distance', '{"p_distance_id":"@D1","p_distance_event_id":"@EV1","p_changes":{"unknown":1}}'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'invalid', 'empty_changes', null, pg_temp.q('update_distance', '{"p_distance_id":"@D1","p_distance_event_id":"@EV1","p_changes":{}}'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'idempotent', 'replay', null, pg_temp.q('update_distance'), 2, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('update_distance', 'idempotent', 'replay_partial', null, pg_temp.q('update_distance', '{"p_distance_id":"@D2","p_distance_event_id":"@EV1","p_changes":{"distance":45,"config":{"total_ends":6,"arrows_per_end":1,"target_face_id":"@F1"}}}'), 2, $$select pg_temp.st_distance('D2') || ' ' || pg_temp.res($1)$$),

  -- disable_round
  ('disable_round', 'success', 'default', null, pg_temp.q('disable_round'), 1, $$select pg_temp.st_round('R1')$$),
  ('disable_round', 'unauthorized', 'default', null, pg_temp.q('disable_round'), 1, $$select pg_temp.st_round('R1')$$),
  ('disable_round', 'invalid', 'unknown_round', null, pg_temp.q('disable_round', '{"p_round_id":"@UNKNOWN"}'), 1, $$select pg_temp.st_round('R1')$$),
  ('disable_round', 'idempotent', 'replay', null, pg_temp.q('disable_round'), 2, $$select pg_temp.st_round('R1')$$),
  ('disable_round', 'idempotent', 'already_disabled', pg_temp.q('disable_round', '{"p_round_event_id":"@EV2"}'), pg_temp.q('disable_round'), 1, $$select pg_temp.st_round('R1')$$),

  -- disable_distance
  ('disable_distance', 'success', 'default', null, pg_temp.q('disable_distance'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('disable_distance', 'unauthorized', 'default', null, pg_temp.q('disable_distance'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('disable_distance', 'invalid', 'unknown_distance', null, pg_temp.q('disable_distance', '{"p_distance_id":"@UNKNOWN"}'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('disable_distance', 'idempotent', 'replay', null, pg_temp.q('disable_distance'), 2, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),
  ('disable_distance', 'idempotent', 'already_disabled', pg_temp.q('disable_distance', '{"p_distance_event_id":"@EV2"}'), pg_temp.q('disable_distance'), 1, $$select pg_temp.st_distance('D1') || ' ' || pg_temp.res($1)$$),

  -- record_shots
  ('record_shots', 'success', 'single', null, pg_temp.q('record_shots'), 1, $$select pg_temp.st_shots('D1') || ' ' || pg_temp.res($1)$$),
  ('record_shots', 'success', 'batch_overwrite_and_proxy', null, pg_temp.q('record_shots', '{"p_shots":[
      {"distance_id":"@D2"},
      {"distance_id":"@D2","shot_event_id":"@EV2","end_number":2,"score_str":"7","score_int":7},
      {"distance_id":"@D2","shot_event_id":"@EV3","end_number":2,"arrow_number":2,"score_str":"5","score_int":5,"shooter_id":"@V"}]}'), 1, $$select pg_temp.st_shots('D2') || ' ' || pg_temp.res($1)$$),
  ('record_shots', 'success', 'batch_partial_unfit', null, pg_temp.q('record_shots', '{"p_shots":[{},{"shot_event_id":"@EV2","arrow_number":2,"score_str":"Z","score_int":99}]}'), 1, $$select pg_temp.st_shots('D1') || ' ' || pg_temp.res($1)$$),
  ('record_shots', 'unauthorized', 'default', null, pg_temp.q('record_shots'), 1, $$select pg_temp.st_shots('D1') || ' ' || pg_temp.res($1)$$),
  ('record_shots', 'invalid', 'shooter_not_member', null, pg_temp.q('record_shots', '{"p_shots":[{"shooter_id":"@N"}]}'), 1, $$select pg_temp.st_shots('D1') || ' ' || pg_temp.res($1)$$),
  ('record_shots', 'invalid', 'batch_with_invalid_shooter', null, pg_temp.q('record_shots', '{"p_shots":[{},{"shot_event_id":"@EV2","arrow_number":2,"shooter_id":"@N"}]}'), 1, $$select pg_temp.st_shots('D1') || ' ' || pg_temp.res($1)$$),
  ('record_shots', 'invalid', 'unknown_distance', null, pg_temp.q('record_shots', '{"p_shots":[{"distance_id":"@UNKNOWN"}]}'), 1, $$select pg_temp.st_shots('D1') || ' ' || pg_temp.res($1)$$),
  ('record_shots', 'invalid', 'end_out_of_range', null, pg_temp.q('record_shots', '{"p_shots":[{"end_number":7}]}'), 1, $$select pg_temp.st_shots('D1') || ' ' || pg_temp.res($1)$$),
  ('record_shots', 'invalid', 'score_not_on_target', null, pg_temp.q('record_shots', '{"p_shots":[{"score_str":"Z","score_int":99}]}'), 1, $$select pg_temp.st_shots('D1') || ' ' || pg_temp.res($1)$$),
  ('record_shots', 'invalid', 'distance_disabled', pg_temp.q('disable_distance', '{"p_distance_event_id":"@EV2"}'), pg_temp.q('record_shots'), 1, $$select pg_temp.st_shots('D1') || ' ' || pg_temp.res($1)$$),
  ('record_shots', 'invalid', 'missing_score_str', null, pg_temp.q('record_shots', '{"p_shots":[{"score_str":null}]}'), 1, $$select pg_temp.st_shots('D1') || ' ' || pg_temp.res($1)$$),
  ('record_shots', 'invalid', 'missing_score_int', null, pg_temp.q('record_shots', '{"p_shots":[{"score_int":null}]}'), 1, $$select pg_temp.st_shots('D1') || ' ' || pg_temp.res($1)$$),
  ('record_shots', 'invalid', 'missing_end_number', null, pg_temp.q('record_shots', '{"p_shots":[{"end_number":null}]}'), 1, $$select pg_temp.st_shots('D1') || ' ' || pg_temp.res($1)$$),
  ('record_shots', 'invalid', 'missing_arrow_number', null, pg_temp.q('record_shots', '{"p_shots":[{"arrow_number":null}]}'), 1, $$select pg_temp.st_shots('D1') || ' ' || pg_temp.res($1)$$),
  ('record_shots', 'invalid', 'missing_event_id', null, pg_temp.q('record_shots', '{"p_shots":[{"shot_event_id":null}]}'), 1, $$select pg_temp.st_shots('D1') || ' ' || pg_temp.res($1)$$),
  ('record_shots', 'idempotent', 'replay', null, pg_temp.q('record_shots'), 2, $$select pg_temp.st_shots('D1') || ' ' || pg_temp.res($1)$$),

  -- clear_shots
  ('clear_shots', 'success', 'single', null, pg_temp.q('clear_shots'), 1, $$select pg_temp.st_shots('D2') || ' ' || pg_temp.res($1)$$),
  ('clear_shots', 'success', 'batch', null, pg_temp.q('clear_shots', '{"p_shots":[{},{"shot_event_id":"@EV2","arrow_number":2}]}'), 1, $$select pg_temp.st_shots('D2') || ' ' || pg_temp.res($1)$$),
  ('clear_shots', 'success', 'unrecorded_cell', null, pg_temp.q('clear_shots', '{"p_shots":[{"end_number":3}]}'), 1, $$select pg_temp.st_shots('D2') || ' ' || pg_temp.res($1)$$),
  ('clear_shots', 'unauthorized', 'default', null, pg_temp.q('clear_shots'), 1, $$select pg_temp.st_shots('D2') || ' ' || pg_temp.res($1)$$),
  ('clear_shots', 'invalid', 'unknown_distance', null, pg_temp.q('clear_shots', '{"p_shots":[{"distance_id":"@UNKNOWN"}]}'), 1, $$select pg_temp.st_shots('D2') || ' ' || pg_temp.res($1)$$),
  ('clear_shots', 'invalid', 'distance_disabled', pg_temp.q('disable_distance', '{"p_distance_event_id":"@EV2","p_distance_id":"@D2"}'), pg_temp.q('clear_shots'), 1, $$select pg_temp.st_shots('D2') || ' ' || pg_temp.res($1)$$),
  ('clear_shots', 'invalid', 'missing_end_number', null, pg_temp.q('clear_shots', '{"p_shots":[{"end_number":null}]}'), 1, $$select pg_temp.st_shots('D2') || ' ' || pg_temp.res($1)$$),
  ('clear_shots', 'invalid', 'missing_arrow_number', null, pg_temp.q('clear_shots', '{"p_shots":[{"arrow_number":null}]}'), 1, $$select pg_temp.st_shots('D2') || ' ' || pg_temp.res($1)$$),
  ('clear_shots', 'invalid', 'missing_event_id', null, pg_temp.q('clear_shots', '{"p_shots":[{"shot_event_id":null}]}'), 1, $$select pg_temp.st_shots('D2') || ' ' || pg_temp.res($1)$$),
  ('clear_shots', 'idempotent', 'replay', null, pg_temp.q('clear_shots'), 2, $$select pg_temp.st_shots('D2') || ' ' || pg_temp.res($1)$$),

  -- save_round_as_preset
  ('save_round_as_preset', 'success', 'default', null, pg_temp.q('save_round_as_preset'), 1, $$select pg_temp.st_preset('Matrix Preset')$$),
  ('save_round_as_preset', 'success', 'name_50_chars', null, pg_temp.q('save_round_as_preset', jsonb_build_object('p_name', repeat('a', 50))), 1, $$select pg_temp.st_preset(repeat('a', 50))$$),
  ('save_round_as_preset', 'invalid', 'name_51_chars', null, pg_temp.q('save_round_as_preset', jsonb_build_object('p_name', repeat('a', 51))), 1, $$select pg_temp.st_preset(repeat('a', 51))$$),
  ('save_round_as_preset', 'invalid', 'invalid_format', null, pg_temp.q('save_round_as_preset', '{"p_format":"invalid"}'), 1, $$select pg_temp.st_preset('Matrix Preset')$$),
  ('save_round_as_preset', 'invalid', 'invalid_bow_type', null, pg_temp.q('save_round_as_preset', '{"p_bow_type":"invalid"}'), 1, $$select pg_temp.st_preset('Matrix Preset')$$),
  ('save_round_as_preset', 'invalid', 'missing_name', null, pg_temp.q('save_round_as_preset', '{"p_name":null}'), 1, $$select pg_temp.st_preset('Matrix Preset')$$),
  ('save_round_as_preset', 'invalid', 'missing_format', null, pg_temp.q('save_round_as_preset', '{"p_format":null}'), 1, $$select pg_temp.st_preset('Matrix Preset')$$),
  ('save_round_as_preset', 'invalid', 'missing_bow_type', null, pg_temp.q('save_round_as_preset', '{"p_bow_type":null}'), 1, $$select pg_temp.st_preset('Matrix Preset')$$),
  ('save_round_as_preset', 'invalid', 'missing_position_key', null, pg_temp.q('save_round_as_preset', '{"p_distances":[{"position_key":null}]}'), 1, $$select pg_temp.st_preset('Matrix Preset')$$),
  ('save_round_as_preset', 'invalid', 'missing_is_marked', null, pg_temp.q('save_round_as_preset', '{"p_distances":[{"is_marked":null}]}'), 1, $$select pg_temp.st_preset('Matrix Preset')$$),
  ('save_round_as_preset', 'invalid', 'missing_target_face', null, pg_temp.q('save_round_as_preset', '{"p_distances":[{"target_face_id":null}]}'), 1, $$select pg_temp.st_preset('Matrix Preset')$$),
  ('save_round_as_preset', 'invalid', 'marked_without_distance', null, pg_temp.q('save_round_as_preset', '{"p_distances":[{"distance":null}]}'), 1, $$select pg_temp.st_preset('Matrix Preset')$$),
  ('save_round_as_preset', 'invalid', 'total_ends_zero', null, pg_temp.q('save_round_as_preset', '{"p_distances":[{"total_ends":0}]}'), 1, $$select pg_temp.st_preset('Matrix Preset')$$),
  ('save_round_as_preset', 'invalid', 'unknown_target_face', null, pg_temp.q('save_round_as_preset', '{"p_distances":[{"target_face_id":"@UNKNOWN"}]}'), 1, $$select pg_temp.st_preset('Matrix Preset')$$),
  ('save_round_as_preset', 'idempotent', 'duplicate_save', null, pg_temp.q('save_round_as_preset'), 2, $$select pg_temp.st_preset('Matrix Preset')$$);

-- ============================================================
-- 該当しない組み合わせ
-- ============================================================

create temp table rpc_na (
  rpc text, aspect text, actor text references rpc_actor, reason text not null,
  primary key (rpc, aspect, actor)
);

-- ラウンドまたは距離のメンバーシップで認可する書き込みRPC。
-- 権限チェックが入力検証より先に走るため、権限のない実行者は入力検証に到達しない。
insert into rpc_na (rpc, aspect, actor, reason)
select r.rpc, n.aspect, n.actor, n.reason
from (values
  ('update_round'), ('create_distance'), ('update_distance'), ('disable_round'), ('disable_distance'),
  ('record_shots'), ('clear_shots')
) as r(rpc)
cross join (values
  ('success', 'viewer', 'viewerは書き込めないため、成功する正常系はない（拒否はunauthorizedで固定する）'),
  ('success', 'non_member', '非メンバーは書き込めないため、成功する正常系はない（拒否はunauthorizedで固定する）'),
  ('unauthorized', 'editor', 'editorは権限を持つため、権限なしの行は成立しない'),
  ('invalid', 'viewer', '権限チェックが入力検証より先に走り、入力検証に到達しない（拒否はunauthorizedで固定する）'),
  ('invalid', 'non_member', '権限チェックが入力検証より先に走り、入力検証に到達しない（拒否はunauthorizedで固定する）'),
  ('idempotent', 'viewer', '冪等性は書き込める実行者の再送が対象で、権限なしの拒否はunauthorizedで固定する'),
  ('idempotent', 'non_member', '冪等性は書き込める実行者の再送が対象で、権限なしの拒否はunauthorizedで固定する')
) as n(aspect, actor, reason);

-- create_roundは既存ラウンドを前提にせず、実行者が新規ラウンドのeditorになる。メンバーシップによる認可がない。
insert into rpc_na (rpc, aspect, actor, reason)
select 'create_round', n.aspect, n.actor, n.reason
from (values
  ('success', 'viewer', '実行者は新規ラウンドのeditorになるため、既存ラウンドのメンバーシップによる差がない。認証済みユーザーの挙動はeditorの行で表す'),
  ('success', 'non_member', '実行者は新規ラウンドのeditorになるため、既存ラウンドのメンバーシップによる差がない。認証済みユーザーの挙動はeditorの行で表す'),
  ('unauthorized', 'editor', '自分が作成したイベントの再送は拒否されない（拒否は他人のevent_idの再送で、viewerとnon_memberの行が固定する）。anonの拒否はrls_matrix.sqlの関数EXECUTE表が固定する'),
  ('invalid', 'viewer', '実行者によって入力検証は変わらない。認証済みユーザーの挙動はeditorの行で表す'),
  ('invalid', 'non_member', '実行者によって入力検証は変わらない。認証済みユーザーの挙動はeditorの行で表す'),
  ('idempotent', 'viewer', '実行者によって冪等性は変わらない。認証済みユーザーの挙動はeditorの行で表す'),
  ('idempotent', 'non_member', '実行者によって冪等性は変わらない。認証済みユーザーの挙動はeditorの行で表す')
) as n(aspect, actor, reason);

-- save_round_as_presetはラウンドと紐付かない個人プリセットを作るため、メンバーシップによる認可がない。
insert into rpc_na (rpc, aspect, actor, reason)
select 'save_round_as_preset', n.aspect, n.actor, n.reason
from (values
  ('unauthorized', 'editor', 'ラウンドと紐付かず、メンバーシップによる認可がない。anonの拒否はrls_matrix.sqlの関数EXECUTE表が固定する'),
  ('unauthorized', 'viewer', 'ラウンドと紐付かず、メンバーシップによる認可がない。anonの拒否はrls_matrix.sqlの関数EXECUTE表が固定する'),
  ('unauthorized', 'non_member', 'ラウンドと紐付かず、メンバーシップによる認可がない。anonの拒否はrls_matrix.sqlの関数EXECUTE表が固定する'),
  ('invalid', 'viewer', '実行者によって入力検証は変わらない。認証済みユーザーの挙動はeditorの行で表す'),
  ('invalid', 'non_member', '実行者によって入力検証は変わらない。認証済みユーザーの挙動はeditorの行で表す'),
  ('idempotent', 'viewer', '実行者によって重複保存の扱いは変わらない。認証済みユーザーの挙動はeditorの行で表す'),
  ('idempotent', 'non_member', '実行者によって重複保存の扱いは変わらない。認証済みユーザーの挙動はeditorの行で表す')
) as n(aspect, actor, reason);

-- ============================================================
-- 期待値表: RPC × 観点 × 変種 × アクター
-- ============================================================
-- n/aでない組み合わせだけを書く。実測は、この表の行ごとに呼び出し表の変種をそのアクターで実行して得る。
-- 結果が 'error:' で始まる行は、拒否されたことと、その理由をメッセージで固定する。
-- 拒否された行の状態が変化していないことも、状態の列で固定する。

create temp table rpc_expected (
  rpc text, aspect text check (aspect in ('success', 'unauthorized', 'invalid', 'idempotent')), variant text,
  actor text references rpc_actor, result text not null, state text not null,
  primary key (rpc, aspect, variant, actor)
);

insert into rpc_expected (rpc, aspect, variant, actor, result, state) values
  ('create_round', 'success', 'default', 'editor', 'ok', 'returned=true round=[Matrix New Round/2026-01-01/outdoor/recurve] rounds=1 round_events=1 editors=1 distances=1 distance_events=1 list=[a:70:true:6x6:0001:40]'),
  ('create_round', 'success', 'field_unmarked', 'editor', 'ok', 'returned=true round=[Matrix New Round/2026-01-01/field/recurve] rounds=1 round_events=1 editors=1 distances=1 distance_events=1 list=[a:-:false:6x6:0001:40]'),
  ('create_round', 'success', 'empty_distances', 'editor', 'ok', 'returned=true round=[Matrix New Round/2026-01-01/outdoor/recurve] rounds=1 round_events=1 editors=1 distances=0 distance_events=0 list=[]'),
  ('create_round', 'success', 'multi_distances', 'editor', 'ok', 'returned=true round=[Matrix New Round/2026-01-01/outdoor/recurve] rounds=1 round_events=1 editors=1 distances=2 distance_events=2 list=[a:70:true:6x6:0001:40 b:50:true:6x6:0001:41]'),
  ('create_round', 'success', 'name_50_chars', 'editor', 'ok', 'returned=true round=[aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/2026-01-01/outdoor/recurve] rounds=1 round_events=1 editors=1 distances=1 distance_events=1 list=[a:70:true:6x6:0001:40]'),
  ('create_round', 'invalid', 'missing_is_marked', 'editor', 'error:[PT422]距離の指定が不正です。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'unmarked_in_outdoor', 'editor', 'error:[PT422]Unmarkedの距離はフィールド種別でのみ使用できます。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'invalid_format', 'editor', 'error:[PT422]種別が不正です。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'invalid_bow_type', 'editor', 'error:[PT422]弓種が不正です。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'name_51_chars', 'editor', 'error:[PT422]ラウンドの指定が不正です。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'missing_name', 'editor', 'error:[PT422]ラウンドの指定が不正です。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'missing_round_date', 'editor', 'error:[PT422]ラウンドの指定が不正です。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'missing_format', 'editor', 'error:[PT422]ラウンドの指定が不正です。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'missing_bow_type', 'editor', 'error:[PT422]ラウンドの指定が不正です。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'missing_target_face', 'editor', 'error:[PT422]距離の指定が不正です。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'missing_position_key', 'editor', 'error:[PT422]距離の指定が不正です。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'marked_without_distance', 'editor', 'error:[PT422]Markedの距離には距離(m)が必要です。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'total_ends_zero', 'editor', 'error:[PT422]距離の指定が不正です。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'unknown_target_face', 'editor', 'error:[PT422]指定された的が存在しません。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'existing_round_id', 'editor', 'error:[PT422]既に存在するラウンドIDです。', 'events=1 revision=1 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=false'),
  ('create_round', 'unauthorized', 'replay_of_others_event', 'viewer', 'error:[PT403]このラウンドを作成した操作ではありません。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'unauthorized', 'replay_of_others_event', 'non_member', 'error:[PT403]このラウンドを作成した操作ではありません。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'event_id_of_update', 'editor', 'error:[PT422]イベントIDが作成以外の操作で使われています。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'duplicate_distance_id', 'editor', 'error:[PT422]距離のID・イベントID・位置が重複しています。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'duplicate_distance_event_id', 'editor', 'error:[PT422]距離のID・イベントID・位置が重複しています。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'duplicate_position_key', 'editor', 'error:[PT422]距離のID・イベントID・位置が重複しています。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'existing_distance_id', 'editor', 'error:[PT422]既に存在する距離IDです。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'existing_distance_event_id', 'editor', 'error:[PT422]既に使われている距離のイベントIDです。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'distances_not_array', 'editor', 'error:[PT422]距離の指定が不正です。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'invalid_distance_id', 'editor', 'error:[PT422]距離の指定が不正です。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'invalid', 'fractional_total_ends', 'editor', 'error:[PT422]距離の指定が不正です。', 'returned=false round=[-] rounds=0 round_events=0 editors=0 distances=0 distance_events=0 list=[]'),
  ('create_round', 'idempotent', 'replay', 'editor', 'ok', 'returned=true round=[Matrix New Round/2026-01-01/outdoor/recurve] rounds=1 round_events=1 editors=1 distances=1 distance_events=1 list=[a:70:true:6x6:0001:40]'),

  ('update_round', 'success', 'default', 'editor', 'ok', 'events=2 revision=2 name=Renamed Round date=2026-02-02 format=indoor bow=compound disabled=false ret=applied fields=name,round_date,format,bow_type'),
  ('update_round', 'success', 'name_only', 'editor', 'ok', 'events=2 revision=2 name=Only Name date=2026-01-01 format=outdoor bow=recurve disabled=false ret=applied fields=name'),
  ('update_round', 'success', 'field_with_unmarked', 'editor', 'ok', 'events=2 revision=2 name=Field Renamed date=2026-01-01 format=field bow=barebow disabled=false ret=applied fields=name,format,bow_type'),
  ('update_round', 'success', 'unmarked_resolved', 'editor', 'ok', 'events=2 revision=2 name=Outdoor Renamed date=2026-01-01 format=outdoor bow=recurve disabled=false ret=applied fields=name,format,bow_type'),
  ('update_round', 'success', 'partial_invariant', 'editor', 'ok', 'events=2 revision=2 name=Partly Renamed date=2026-01-01 format=field bow=recurve disabled=false ret=applied fields=name rejected=format:INVARIANT'),
  ('update_round', 'unauthorized', 'default', 'viewer', 'error:[PT403]このラウンドを編集する権限がありません。', 'events=1 revision=1 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=false ret=-'),
  ('update_round', 'unauthorized', 'default', 'non_member', 'error:[PT403]このラウンドを編集する権限がありません。', 'events=1 revision=1 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=false ret=-'),
  ('update_round', 'invalid', 'unmarked_remains', 'editor', 'ok', 'events=1 revision=1 name=Matrix Field date=2026-01-01 format=field bow=recurve disabled=false ret=none rejected=format:INVARIANT'),
  ('update_round', 'invalid', 'round_disabled', 'editor', 'ok', 'events=2 revision=2 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=true ret=DISABLED'),
  ('update_round', 'invalid', 'unknown_round', 'editor', 'error:[PT403]このラウンドを編集する権限がありません。', 'events=1 revision=1 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=false ret=-'),
  ('update_round', 'invalid', 'invalid_format', 'editor', 'error:[PT422]種別が不正です。', 'events=1 revision=1 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=false ret=-'),
  ('update_round', 'invalid', 'invalid_bow_type', 'editor', 'error:[PT422]弓種が不正です。', 'events=1 revision=1 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=false ret=-'),
  ('update_round', 'invalid', 'name_51_chars', 'editor', 'error:[PT422]ラウンド名が不正です。', 'events=1 revision=1 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=false ret=-'),
  ('update_round', 'invalid', 'missing_name', 'editor', 'error:[PT422]ラウンド名が不正です。', 'events=1 revision=1 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=false ret=-'),
  ('update_round', 'invalid', 'missing_round_date', 'editor', 'error:[PT422]実施日が不正です。', 'events=1 revision=1 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=false ret=-'),
  ('update_round', 'invalid', 'missing_format', 'editor', 'error:[PT422]種別が不正です。', 'events=1 revision=1 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=false ret=-'),
  ('update_round', 'invalid', 'missing_bow_type', 'editor', 'error:[PT422]弓種が不正です。', 'events=1 revision=1 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=false ret=-'),
  ('update_round', 'invalid', 'invalid_round_date', 'editor', 'error:[PT422]実施日が不正です。', 'events=1 revision=1 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=false ret=-'),
  ('update_round', 'invalid', 'unknown_key', 'editor', 'error:[PT422]設定の変更に未知の項目が含まれています。', 'events=1 revision=1 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=false ret=-'),
  ('update_round', 'invalid', 'empty_changes', 'editor', 'error:[PT422]設定の変更はキーを持つオブジェクトで指定してください。', 'events=1 revision=1 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=false ret=-'),
  ('update_round', 'idempotent', 'replay', 'editor', 'ok', 'events=2 revision=2 name=Renamed Round date=2026-02-02 format=indoor bow=compound disabled=false ret=applied fields=name,round_date,format,bow_type'),
  ('update_round', 'idempotent', 'replay_partial', 'editor', 'ok', 'events=2 revision=2 name=Partly Renamed date=2026-01-01 format=field bow=recurve disabled=false ret=applied fields=name rejected=format:REJECTED'),

  ('create_distance', 'success', 'default', 'editor', 'ok', 'distances=1 distance_events=1 revision=1 position=c distance=30 ends=4 arrows=3 face=0002 marked=true ret=applied'),
  ('create_distance', 'success', 'unmarked_in_field', 'editor', 'ok', 'distances=1 distance_events=1 revision=1 position=c distance=- ends=4 arrows=3 face=0002 marked=false ret=applied'),
  ('create_distance', 'unauthorized', 'default', 'viewer', 'error:[PT403]このラウンドに距離を追加する権限がありません。', 'distances=0 distance_events=0 revision=- position=- distance=- ends=- arrows=- face=- marked=- ret=-'),
  ('create_distance', 'unauthorized', 'default', 'non_member', 'error:[PT403]このラウンドに距離を追加する権限がありません。', 'distances=0 distance_events=0 revision=- position=- distance=- ends=- arrows=- face=- marked=- ret=-'),
  ('create_distance', 'invalid', 'unmarked_in_outdoor', 'editor', 'ok', 'distances=0 distance_events=0 revision=- position=- distance=- ends=- arrows=- face=- marked=- ret=INVARIANT'),
  ('create_distance', 'invalid', 'round_disabled', 'editor', 'ok', 'distances=0 distance_events=0 revision=- position=- distance=- ends=- arrows=- face=- marked=- ret=DISABLED'),
  ('create_distance', 'invalid', 'unknown_round', 'editor', 'error:[PT403]このラウンドに距離を追加する権限がありません。', 'distances=0 distance_events=0 revision=- position=- distance=- ends=- arrows=- face=- marked=- ret=-'),
  ('create_distance', 'invalid', 'missing_is_marked', 'editor', 'error:[PT422]距離の指定が不正です。', 'distances=0 distance_events=0 revision=- position=- distance=- ends=- arrows=- face=- marked=- ret=-'),
  ('create_distance', 'invalid', 'missing_target_face', 'editor', 'error:[PT422]距離の指定が不正です。', 'distances=0 distance_events=0 revision=- position=- distance=- ends=- arrows=- face=- marked=- ret=-'),
  ('create_distance', 'invalid', 'missing_position_key', 'editor', 'error:[PT422]距離の指定が不正です。', 'distances=0 distance_events=0 revision=- position=- distance=- ends=- arrows=- face=- marked=- ret=-'),
  ('create_distance', 'invalid', 'marked_without_distance', 'editor', 'error:[PT422]Markedの距離には距離(m)が必要です。', 'distances=0 distance_events=0 revision=- position=- distance=- ends=- arrows=- face=- marked=- ret=-'),
  ('create_distance', 'invalid', 'total_ends_zero', 'editor', 'error:[PT422]距離の指定が不正です。', 'distances=0 distance_events=0 revision=- position=- distance=- ends=- arrows=- face=- marked=- ret=-'),
  ('create_distance', 'invalid', 'unknown_target_face', 'editor', 'error:[PT422]指定された的が存在しません。', 'distances=0 distance_events=0 revision=- position=- distance=- ends=- arrows=- face=- marked=- ret=-'),
  ('create_distance', 'invalid', 'existing_distance_id', 'editor', 'error:[PT422]既に存在する距離IDです。', 'distances=1 distance_events=1 revision=1 position=a distance=70 ends=6 arrows=6 face=0001 marked=true ret=-'),
  ('create_distance', 'invalid', 'duplicate_position_key', 'editor', 'error:[PT422]同じ位置の距離が既に存在します。', 'distances=0 distance_events=0 revision=- position=- distance=- ends=- arrows=- face=- marked=- ret=-'),
  ('create_distance', 'idempotent', 'replay', 'editor', 'ok', 'distances=1 distance_events=1 revision=1 position=c distance=30 ends=4 arrows=3 face=0002 marked=true ret=applied'),

  ('update_distance', 'success', 'default', 'editor', 'ok', 'events=2 revision=2 distance=55 ends=3 arrows=3 face=0002 marked=true disabled=false ret=applied fields=distance,config'),
  ('update_distance', 'success', 'distance_only', 'editor', 'ok', 'events=2 revision=2 distance=40 ends=6 arrows=6 face=0001 marked=true disabled=false ret=applied fields=distance'),
  ('update_distance', 'success', 'config_only', 'editor', 'ok', 'events=2 revision=2 distance=70 ends=3 arrows=3 face=0002 marked=true disabled=false ret=applied fields=config'),
  ('update_distance', 'success', 'field_marked_to_unmarked', 'editor', 'ok', 'events=2 revision=2 distance=- ends=4 arrows=3 face=0002 marked=false disabled=false ret=applied fields=is_marked,distance'),
  ('update_distance', 'success', 'with_shots_distance_only', 'editor', 'ok', 'events=2 revision=2 distance=40 ends=6 arrows=6 face=0001 marked=true disabled=false ret=applied fields=distance'),
  ('update_distance', 'success', 'with_shots_config_fits', 'editor', 'ok', 'events=2 revision=2 distance=50 ends=4 arrows=6 face=0002 marked=true disabled=false ret=applied fields=config'),
  ('update_distance', 'success', 'with_shots_unmarked_to_marked', 'editor', 'ok', 'events=3 revision=3 distance=60 ends=6 arrows=6 face=0001 marked=true disabled=false ret=applied fields=is_marked'),
  ('update_distance', 'success', 'with_shots_unmarked_stays', 'editor', 'ok', 'events=2 revision=2 distance=45 ends=6 arrows=6 face=0001 marked=false disabled=false ret=applied fields=is_marked,distance'),
  ('update_distance', 'success', 'marked_with_distance_same_save', 'editor', 'ok', 'events=2 revision=2 distance=60 ends=6 arrows=6 face=0001 marked=true disabled=false ret=applied fields=is_marked,distance'),
  ('update_distance', 'success', 'partial_config_unfit', 'editor', 'ok', 'events=2 revision=2 distance=45 ends=6 arrows=6 face=0001 marked=true disabled=false ret=applied fields=distance rejected=config:UNFIT'),
  ('update_distance', 'unauthorized', 'default', 'viewer', 'error:[PT403]この距離を編集する権限がありません。', 'events=1 revision=1 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=false ret=-'),
  ('update_distance', 'unauthorized', 'default', 'non_member', 'error:[PT403]この距離を編集する権限がありません。', 'events=1 revision=1 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=false ret=-'),
  ('update_distance', 'invalid', 'unmarked_in_outdoor', 'editor', 'ok', 'events=1 revision=1 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=false ret=none rejected=is_marked:INVARIANT'),
  ('update_distance', 'invalid', 'marked_distance_cleared', 'editor', 'ok', 'events=1 revision=1 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=false ret=none rejected=distance:INVARIANT'),
  ('update_distance', 'invalid', 'with_shots_arrows_unfit', 'editor', 'ok', 'events=1 revision=1 distance=50 ends=6 arrows=6 face=0001 marked=true disabled=false ret=none rejected=config:UNFIT'),
  ('update_distance', 'invalid', 'with_shots_ends_unfit', 'editor', 'ok', 'events=1 revision=1 distance=50 ends=6 arrows=6 face=0001 marked=true disabled=false ret=none rejected=config:UNFIT'),
  ('update_distance', 'invalid', 'distance_disabled', 'editor', 'ok', 'events=2 revision=2 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=true ret=DISABLED'),
  ('update_distance', 'invalid', 'unknown_distance', 'editor', 'ok', 'events=1 revision=1 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=false ret=MISSING'),
  ('update_distance', 'invalid', 'missing_is_marked', 'editor', 'error:[PT422]Marked/Unmarkedが不正です。', 'events=1 revision=1 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=false ret=-'),
  ('update_distance', 'invalid', 'marked_with_unset_distance', 'editor', 'error:[PT422]Markedにする変更と距離(m)の未設定を同時に指定できません。', 'events=1 revision=1 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=false ret=-'),
  ('update_distance', 'invalid', 'config_missing_target_face', 'editor', 'error:[PT422]構成は的・エンド数・矢数の3項目で指定してください。', 'events=1 revision=1 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=false ret=-'),
  ('update_distance', 'invalid', 'config_target_face_null', 'editor', 'error:[PT422]構成の値が不正です。', 'events=1 revision=1 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=false ret=-'),
  ('update_distance', 'invalid', 'total_ends_zero', 'editor', 'error:[PT422]構成の値が不正です。', 'events=1 revision=1 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=false ret=-'),
  ('update_distance', 'invalid', 'unknown_target_face', 'editor', 'error:[PT422]指定された的が存在しません。', 'events=1 revision=1 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=false ret=-'),
  ('update_distance', 'invalid', 'distance_zero', 'editor', 'error:[PT422]距離(m)が不正です。', 'events=1 revision=1 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=false ret=-'),
  ('update_distance', 'invalid', 'unknown_key', 'editor', 'error:[PT422]距離の変更に未知の項目が含まれています。', 'events=1 revision=1 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=false ret=-'),
  ('update_distance', 'invalid', 'empty_changes', 'editor', 'error:[PT422]距離の変更はキーを持つオブジェクトで指定してください。', 'events=1 revision=1 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=false ret=-'),
  ('update_distance', 'idempotent', 'replay', 'editor', 'ok', 'events=2 revision=2 distance=55 ends=3 arrows=3 face=0002 marked=true disabled=false ret=applied fields=distance,config'),
  ('update_distance', 'idempotent', 'replay_partial', 'editor', 'ok', 'events=2 revision=2 distance=45 ends=6 arrows=6 face=0001 marked=true disabled=false ret=applied fields=distance rejected=config:REJECTED'),

  ('disable_round', 'success', 'default', 'editor', 'ok', 'events=2 revision=2 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=true'),
  ('disable_round', 'unauthorized', 'default', 'viewer', 'error:[PT403]このラウンドを削除する権限がありません。', 'events=1 revision=1 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=false'),
  ('disable_round', 'unauthorized', 'default', 'non_member', 'error:[PT403]このラウンドを削除する権限がありません。', 'events=1 revision=1 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=false'),
  ('disable_round', 'invalid', 'unknown_round', 'editor', 'error:[PT403]このラウンドを削除する権限がありません。', 'events=1 revision=1 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=false'),
  ('disable_round', 'idempotent', 'replay', 'editor', 'ok', 'events=2 revision=2 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=true'),
  ('disable_round', 'idempotent', 'already_disabled', 'editor', 'ok', 'events=3 revision=3 name=Matrix Outdoor date=2026-01-01 format=outdoor bow=recurve disabled=true'),

  ('disable_distance', 'success', 'default', 'editor', 'ok', 'events=2 revision=2 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=true ret=applied'),
  ('disable_distance', 'unauthorized', 'default', 'viewer', 'error:[PT403]この距離を削除する権限がありません。', 'events=1 revision=1 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=false ret=-'),
  ('disable_distance', 'unauthorized', 'default', 'non_member', 'error:[PT403]この距離を削除する権限がありません。', 'events=1 revision=1 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=false ret=-'),
  ('disable_distance', 'invalid', 'unknown_distance', 'editor', 'ok', 'events=1 revision=1 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=false ret=MISSING'),
  ('disable_distance', 'idempotent', 'replay', 'editor', 'ok', 'events=2 revision=2 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=true ret=applied'),
  ('disable_distance', 'idempotent', 'already_disabled', 'editor', 'ok', 'events=2 revision=2 distance=70 ends=6 arrows=6 face=0001 marked=true disabled=true ret=DISABLED'),

  ('record_shots', 'success', 'single', 'editor', 'ok', 'events=1 shots=[1-1:9/editor/r1] ret=[applied]'),
  ('record_shots', 'success', 'batch_overwrite_and_proxy', 'editor', 'ok', 'events=5 shots=[1-1:9/editor/r2 1-2:9/editor/r1 2-1:7/editor/r1 2-2:5/viewer/r1] ret=[applied,applied,applied]'),
  ('record_shots', 'success', 'batch_partial_unfit', 'editor', 'ok', 'events=1 shots=[1-1:9/editor/r1] ret=[applied,UNFIT]'),
  ('record_shots', 'unauthorized', 'default', 'viewer', 'error:[PT403]この距離に矢を記録する権限がありません。', 'events=0 shots=[] ret=-'),
  ('record_shots', 'unauthorized', 'default', 'non_member', 'error:[PT403]この距離に矢を記録する権限がありません。', 'events=0 shots=[] ret=-'),
  ('record_shots', 'invalid', 'shooter_not_member', 'editor', 'error:[PT403]指定された射手はこのラウンドのメンバーではありません。', 'events=0 shots=[] ret=-'),
  ('record_shots', 'invalid', 'batch_with_invalid_shooter', 'editor', 'error:[PT403]指定された射手はこのラウンドのメンバーではありません。', 'events=0 shots=[] ret=-'),
  ('record_shots', 'invalid', 'unknown_distance', 'editor', 'ok', 'events=0 shots=[] ret=[MISSING]'),
  ('record_shots', 'invalid', 'end_out_of_range', 'editor', 'ok', 'events=0 shots=[] ret=[UNFIT]'),
  ('record_shots', 'invalid', 'score_not_on_target', 'editor', 'ok', 'events=0 shots=[] ret=[UNFIT]'),
  ('record_shots', 'invalid', 'distance_disabled', 'editor', 'ok', 'events=0 shots=[] ret=[DISABLED]'),
  ('record_shots', 'invalid', 'missing_score_str', 'editor', 'error:[PT422]矢の記録の指定が不正です。', 'events=0 shots=[] ret=-'),
  ('record_shots', 'invalid', 'missing_score_int', 'editor', 'error:[PT422]矢の記録の指定が不正です。', 'events=0 shots=[] ret=-'),
  ('record_shots', 'invalid', 'missing_end_number', 'editor', 'error:[PT422]矢の記録の指定が不正です。', 'events=0 shots=[] ret=-'),
  ('record_shots', 'invalid', 'missing_arrow_number', 'editor', 'error:[PT422]矢の記録の指定が不正です。', 'events=0 shots=[] ret=-'),
  ('record_shots', 'invalid', 'missing_event_id', 'editor', 'error:[PT422]矢の記録の指定が不正です。', 'events=0 shots=[] ret=-'),
  ('record_shots', 'idempotent', 'replay', 'editor', 'ok', 'events=1 shots=[1-1:9/editor/r1] ret=[applied]'),

  ('clear_shots', 'success', 'single', 'editor', 'ok', 'events=3 shots=[1-1:X/editor/r2/cleared 1-2:9/editor/r1] ret=[applied]'),
  ('clear_shots', 'success', 'batch', 'editor', 'ok', 'events=4 shots=[1-1:X/editor/r2/cleared 1-2:9/editor/r2/cleared] ret=[applied,applied]'),
  ('clear_shots', 'success', 'unrecorded_cell', 'editor', 'ok', 'events=3 shots=[1-1:X/editor/r1 1-2:9/editor/r1] ret=[applied]'),
  ('clear_shots', 'unauthorized', 'default', 'viewer', 'error:[PT403]この距離の矢を取り消す権限がありません。', 'events=2 shots=[1-1:X/editor/r1 1-2:9/editor/r1] ret=-'),
  ('clear_shots', 'unauthorized', 'default', 'non_member', 'error:[PT403]この距離の矢を取り消す権限がありません。', 'events=2 shots=[1-1:X/editor/r1 1-2:9/editor/r1] ret=-'),
  ('clear_shots', 'invalid', 'unknown_distance', 'editor', 'ok', 'events=2 shots=[1-1:X/editor/r1 1-2:9/editor/r1] ret=[MISSING]'),
  ('clear_shots', 'invalid', 'distance_disabled', 'editor', 'ok', 'events=2 shots=[1-1:X/editor/r1 1-2:9/editor/r1] ret=[DISABLED]'),
  ('clear_shots', 'invalid', 'missing_end_number', 'editor', 'error:[PT422]矢の取り消しの指定が不正です。', 'events=2 shots=[1-1:X/editor/r1 1-2:9/editor/r1] ret=-'),
  ('clear_shots', 'invalid', 'missing_arrow_number', 'editor', 'error:[PT422]矢の取り消しの指定が不正です。', 'events=2 shots=[1-1:X/editor/r1 1-2:9/editor/r1] ret=-'),
  ('clear_shots', 'invalid', 'missing_event_id', 'editor', 'error:[PT422]矢の取り消しの指定が不正です。', 'events=2 shots=[1-1:X/editor/r1 1-2:9/editor/r1] ret=-'),
  ('clear_shots', 'idempotent', 'replay', 'editor', 'ok', 'events=3 shots=[1-1:X/editor/r2/cleared 1-2:9/editor/r1] ret=[applied]'),

  ('save_round_as_preset', 'success', 'default', 'editor', 'ok', 'presets=1 owner=editor format=field bow=compound distance_rows=2 distances=[a:50:true:6x6:0001 b:-:false:4x6:0001]'),
  ('save_round_as_preset', 'success', 'default', 'viewer', 'ok', 'presets=1 owner=viewer format=field bow=compound distance_rows=2 distances=[a:50:true:6x6:0001 b:-:false:4x6:0001]'),
  ('save_round_as_preset', 'success', 'default', 'non_member', 'ok', 'presets=1 owner=non_member format=field bow=compound distance_rows=2 distances=[a:50:true:6x6:0001 b:-:false:4x6:0001]'),
  ('save_round_as_preset', 'success', 'name_50_chars', 'editor', 'ok', 'presets=1 owner=editor format=field bow=compound distance_rows=2 distances=[a:50:true:6x6:0001 b:-:false:4x6:0001]'),
  ('save_round_as_preset', 'invalid', 'name_51_chars', 'editor', 'error:new row for relation "preset_rounds" violates check constraint "preset_rounds_name_length"', 'presets=0 owner=- format=- bow=- distance_rows=0 distances=[]'),
  ('save_round_as_preset', 'invalid', 'invalid_format', 'editor', 'error:new row for relation "preset_rounds" violates check constraint "preset_rounds_format_check"', 'presets=0 owner=- format=- bow=- distance_rows=0 distances=[]'),
  ('save_round_as_preset', 'invalid', 'invalid_bow_type', 'editor', 'error:new row for relation "preset_rounds" violates check constraint "preset_rounds_bow_type_check"', 'presets=0 owner=- format=- bow=- distance_rows=0 distances=[]'),
  ('save_round_as_preset', 'invalid', 'missing_name', 'editor', 'error:null value in column "name" of relation "preset_rounds" violates not-null constraint', 'presets=0 owner=- format=- bow=- distance_rows=0 distances=[]'),
  ('save_round_as_preset', 'invalid', 'missing_format', 'editor', 'error:null value in column "format" of relation "preset_rounds" violates not-null constraint', 'presets=0 owner=- format=- bow=- distance_rows=0 distances=[]'),
  ('save_round_as_preset', 'invalid', 'missing_bow_type', 'editor', 'error:null value in column "bow_type" of relation "preset_rounds" violates not-null constraint', 'presets=0 owner=- format=- bow=- distance_rows=0 distances=[]'),
  ('save_round_as_preset', 'invalid', 'missing_position_key', 'editor', 'error:null value in column "position_key" of relation "preset_distances" violates not-null constraint', 'presets=0 owner=- format=- bow=- distance_rows=0 distances=[]'),
  ('save_round_as_preset', 'invalid', 'missing_is_marked', 'editor', 'error:null value in column "is_marked" of relation "preset_distances" violates not-null constraint', 'presets=0 owner=- format=- bow=- distance_rows=0 distances=[]'),
  ('save_round_as_preset', 'invalid', 'missing_target_face', 'editor', 'error:null value in column "target_face_id" of relation "preset_distances" violates not-null constraint', 'presets=0 owner=- format=- bow=- distance_rows=0 distances=[]'),
  ('save_round_as_preset', 'invalid', 'marked_without_distance', 'editor', 'error:new row for relation "preset_distances" violates check constraint "preset_distances_marked_requires_distance"', 'presets=0 owner=- format=- bow=- distance_rows=0 distances=[]'),
  ('save_round_as_preset', 'invalid', 'total_ends_zero', 'editor', 'error:new row for relation "preset_distances" violates check constraint "preset_distances_total_ends_positive"', 'presets=0 owner=- format=- bow=- distance_rows=0 distances=[]'),
  ('save_round_as_preset', 'invalid', 'unknown_target_face', 'editor', 'error:insert or update on table "preset_distances" violates foreign key constraint "preset_distances_target_face_id_fkey"', 'presets=0 owner=- format=- bow=- distance_rows=0 distances=[]'),
  ('save_round_as_preset', 'idempotent', 'duplicate_save', 'editor', 'ok', 'presets=2 owner=editor format=field bow=compound distance_rows=4 distances=[a:50:true:6x6:0001 b:-:false:4x6:0001]');

create temp table rpc_actual as
select e.rpc, e.aspect, e.variant, e.actor, r.result, r.state
from rpc_expected e
join rpc_call c using (rpc, aspect, variant)
cross join lateral pg_temp.rpc_run(e.actor, c.setup, c.call, c.repeat, c.probe) as r;

-- ============================================================
-- 検証
-- ============================================================

select is_empty(
  $$select coalesce(a.rpc, e.rpc) as rpc, coalesce(a.aspect, e.aspect) as aspect,
      coalesce(a.variant, e.variant) as variant, coalesce(a.actor, e.actor) as actor,
      a.result as actual_result, e.result as expected_result, a.state as actual_state, e.state as expected_state
    from rpc_actual a
    full join rpc_expected e on (a.rpc, a.aspect, a.variant, a.actor) = (e.rpc, e.aspect, e.variant, e.actor)
    where a.result is distinct from e.result or a.state is distinct from e.state$$,
  '全RPCの実測（結果と呼び出し後の状態）が期待値表と一致する'
);

-- カバレッジガード。公開された関数を増やしたとき、この表への追加を忘れるとここで落ちる。
-- 照合はシグネチャ単位で行うため、同名で引数違いのオーバーロードや、STABLEなどvolatile以外の関数の追加も検出する。
-- 表のキーはRPC名のまま。登録済みのシグネチャ以外は「未登録」として落ちる。
create temp table rpc_signature (rpc text not null, sig text primary key);
insert into rpc_signature (rpc, sig) values
  ('create_round', 'create_round(uuid,uuid,text,date,text,text,jsonb)'),
  ('update_round', 'update_round(uuid,uuid,jsonb)'),
  ('create_distance', 'create_distance(uuid,uuid,uuid,text,bigint,bigint,bigint,uuid,boolean)'),
  ('update_distance', 'update_distance(uuid,uuid,jsonb)'),
  ('disable_round', 'disable_round(uuid,uuid)'),
  ('disable_distance', 'disable_distance(uuid,uuid)'),
  ('record_shots', 'record_shots(jsonb)'),
  ('clear_shots', 'clear_shots(jsonb)'),
  ('save_round_as_preset', 'save_round_as_preset(text,text,text,jsonb)');

-- RPCではないと明示する関数。ここに無いpublicの関数は、volatilityによらずRPCとして表への登録を求める。
create temp table rpc_helper (sig text primary key, reason text not null);
insert into rpc_helper (sig, reason) values
  ('is_round_member(uuid)', 'RLSポリシーが使うSTABLEな判定ヘルパーで、書き込みRPCではない'),
  ('is_round_editor(uuid)', 'RPCの権限チェックが使うSTABLEな判定ヘルパーで、書き込みRPCではない');

-- トリガー関数は直接呼べないため対象外。
create temp view rpc_target as
select p.proname::text as rpc, p.oid::regprocedure::text as sig
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.prokind = 'f'
  and p.prorettype <> 'trigger'::regtype
  and has_function_privilege('authenticated', p.oid, 'execute')
  and p.oid::regprocedure::text not in (select sig from rpc_helper);

select is_empty(
  $$select sig from rpc_target except select sig from rpc_signature$$,
  'publicの全ての関数が、登録済みのRPCのシグネチャか、RPCでないと明示した関数の一覧にある'
);

select is_empty(
  $$select sig from rpc_signature except select sig from rpc_target$$,
  '登録済みのRPCのシグネチャは、全て公開された関数として実在する'
);

select is_empty(
  $$select sig from rpc_helper except select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace$$,
  'RPCでないと明示した関数は、全て実在する'
);

select is_empty(
  $$select t.rpc, a.aspect, ac.actor
    from rpc_target t
    cross join (values ('success'), ('unauthorized'), ('invalid'), ('idempotent')) as a(aspect)
    cross join rpc_actor ac
    where not exists (select 1 from rpc_expected e where (e.rpc, e.aspect, e.actor) = (t.rpc, a.aspect, ac.actor))
      and not exists (select 1 from rpc_na n where (n.rpc, n.aspect, n.actor) = (t.rpc, a.aspect, ac.actor))$$,
  '公開されたRPCの全ての RPC × 観点 × アクター が、期待値表かn/aに存在する'
);

select is_empty(
  $$select rpc from (select rpc from rpc_expected union select rpc from rpc_call union select rpc from rpc_na) as t
    except select rpc from rpc_target$$,
  '表に書かれたRPCは、全て公開されたRPCとして実在する'
);

select is_empty(
  $$select e.rpc, e.aspect, e.variant, e.actor
    from rpc_expected e left join rpc_call c using (rpc, aspect, variant)
    where c.rpc is null$$,
  '期待値表の全ての行に対応する呼び出しがある'
);

select is_empty(
  $$select c.rpc, c.aspect, c.variant
    from rpc_call c
    where not exists (select 1 from rpc_expected e where (e.rpc, e.aspect, e.variant) = (c.rpc, c.aspect, c.variant))$$,
  '呼び出し表の全ての変種が、期待値表で1つ以上のアクターから使われている'
);

select is_empty(
  $$select e.rpc, e.aspect, e.actor
    from rpc_expected e join rpc_na n using (rpc, aspect, actor)$$,
  '期待値表の行とn/aが同じ RPC × 観点 × アクター で重複していない'
);

select is_empty(
  $$select rpc, aspect, actor from rpc_na where btrim(reason) = ''$$,
  'n/aの全ての行に理由がある'
);

-- 呼び出しSQLの誤記（存在しない関数や列、構文エラー）を、期待値として固定してしまわないための確認。
select is_empty(
  $$select rpc, aspect, variant, actor, result from rpc_expected
    where result ~ '^error:(function |column |relation |syntax error|invalid input syntax|could not|named parameter)'$$,
  '期待値のエラーが、呼び出しSQLの誤記によるものではない'
);

select * from finish();

rollback;
