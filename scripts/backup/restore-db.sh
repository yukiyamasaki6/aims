#!/usr/bin/env bash
# 復元(docs/backup.md)のDBの部分。取得(dump-db.sh)の出力を、取得の版のmigrationだけを適用した空の復元先へ入れ、確かめる。
# 手順の全体と前提は docs/backup.md に従う。
#
# 使い方: DATABASE_URL=<復元先の接続文字列> scripts/backup/restore-db.sh <取得の出力のディレクトリ> [削除の記録の利用者IDの一覧]
#   利用者IDの一覧は、1行に1つの利用者ID(R2のdeletions/のオブジェクト名から接頭を除いたもの)。省略すると削除の後の状態へ戻す段階を行わない
#
# 入力をローカルで確かめた後、1つの接続の1つのトランザクションで次を行う。どれかが失敗したら、確定せずに止まる:
#   1. publicとauthの表(auth.schema_migrationsを除く)と、migration履歴を、待たずに排他ロックする
#   2. 復元先のmigration履歴の版が、取得の記録と一致することを確かめる
#   3. 復元先に利用者や記録のデータが無いことを確かめる(check-empty.sql)
#   4. 取得にある表を空にしてから(migrationが入れた行を消す)、トリガーと外部キーの検査を止めてデータを入れる
#   5. 各表の行数が取得の記録と一致し、外部キーごとに参照先の無い行が0であることを確かめる
#   6. 削除の記録にある利用者を、purge_accountで削除の後の状態へ戻す(居なければ何もしない)
#   7. 確定する
set -euo pipefail

backup_dir=${1:?取得の出力のディレクトリを指定してください}
deletions_file=${2:-}
: "${DATABASE_URL:?DATABASE_URLに復元先の接続文字列を指定してください}"

manifest=$backup_dir/manifest.json
data=$backup_dir/data.sql
check_empty=$(cd "$(dirname "$0")" && pwd)/check-empty.sql
uuid_pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

fail() {
  echo "$*" >&2
  exit 1
}

# data.sqlのCOPYの対象の表を、データの行を読み飛ばして取り出す。想定外の対象と、途中で終わるデータは失敗にする。
copy_tables() {
  awk '
    inside { if ($0 == "\\.") inside = 0; next }
    /^COPY / {
      if ($0 !~ /^COPY "(public|auth)"\."[^" ]+" .*FROM stdin;$/ || $2 == "\"auth\".\"schema_migrations\"") {
        print "data.sqlに想定外のCOPYがあります: " $2 > "/dev/stderr"
        failed = 1
        exit
      }
      print $2
      inside = 1
    }
    END {
      if (!failed && inside) {
        print "data.sqlのCOPYのデータが途中で終わっています" > "/dev/stderr"
        failed = 1
      }
      exit failed
    }
  ' "$1"
}

# 入力の不備は、復元先へ接続する前に止める。
for file in "$manifest" "$data" "$check_empty"; do
  [[ -f $file ]] || fail "ありません: $file"
done
jq -e '
  .format == 1
  and (.migration_versions
    | type == "array" and length > 0 and all(.[]; type == "string" and test("^[0-9]+$")) and (unique | length) == length)
  and (.row_counts
    | type == "object" and length > 0 and all(to_entries[];
      (.key | test("^\"(public|auth)\"\\.\"[^\"\\s]+\"$"))
      and (.value | type == "number" and . >= 0 and . == floor)))
' "$manifest" >/dev/null || fail "取得の記録の形が想定と違います(format、migration_versions、row_counts): $manifest"

copied=$(copy_tables "$data")
recorded=$(jq -r '.row_counts | keys[]' "$manifest")
[[ $(sort <<<"$copied") == "$(sort <<<"$recorded")" ]] || fail "data.sqlのCOPYの対象の表が、取得の記録の表と一致しません"

deletion_ids=()
if [[ -n $deletions_file ]]; then
  [[ -r $deletions_file && ! -d $deletions_file ]] || fail "削除の記録の一覧を読めません: $deletions_file"
  line=0
  # 末尾に改行の無い最後の行も読む。
  while read -r user_id || [[ -n $user_id ]]; do
    line=$((line + 1))
    [[ -z $user_id ]] && continue
    [[ $user_id =~ $uuid_pattern ]] || fail "利用者IDの形ではありません: $deletions_file の${line}行目"
    deletion_ids+=("$user_id")
  done <"$deletions_file"
fi

umask 077
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# 書き換えを始めたことの印。失敗したときの案内を分ける。
writing=$work/writing

manifest_literal=$(jq -c . "$manifest" | sed "s/'/''/g")
ids_literal=$(
  IFS=,
  echo "${deletion_ids[*]}"
)

{
  cat <<'SQL'
\echo 1. 表をロックします
begin isolation level read committed;
set local search_path = '';
set local row_security = off;
SQL
  printf "create temporary table restore_input on commit drop as\n  select '%s'::jsonb as manifest, '{%s}'::uuid[] as deletion_ids;\n" \
    "$manifest_literal" "$ids_literal"
  cat <<'SQL'

-- 検査と書き換えの対象の表。publicとauthの表(パーティションと継承の子を含む)と、アプリのmigration履歴。
-- auth.schema_migrationsは、認証サービスの構造の管理の履歴で利用者のデータを持たず、接続のロールが排他ロックできず、書き換えないため除く。
create temporary view restore_catalog_tables as
with recursive relations (oid, check_empty) as (
  select c.oid, n.nspname <> 'supabase_migrations'
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'f', 'm')
    and (
      (n.nspname in ('public', 'auth') and not (n.nspname = 'auth' and c.relname = 'schema_migrations'))
      or (n.nspname = 'supabase_migrations' and c.relname = 'schema_migrations')
    )
  union
  select i.inhrelid, r.check_empty
  from relations r
  join pg_catalog.pg_inherits i on i.inhparent = r.oid
)
select c.oid, n.nspname::text as schema_name, c.relname::text as table_name, c.relkind, r.check_empty
from relations r
join pg_catalog.pg_class c on c.oid = r.oid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace;

create temporary table restore_tables on commit drop as select * from pg_temp.restore_catalog_tables;

do $$
declare
  t record;
begin
  for t in
    select * from pg_temp.restore_tables order by schema_name collate "C", table_name collate "C"
  loop
    if t.relkind not in ('r', 'p') then
      raise exception '確認できない構造・権限: %.% は外部表かマテリアライズドビューです', t.schema_name, t.table_name;
    end if;
    begin
      execute format('lock table only %I.%I in access exclusive mode nowait', t.schema_name, t.table_name);
    exception
      when lock_not_available then
        raise exception '%.% を他の接続が使っているため、ロックできません', t.schema_name, t.table_name;
      when others then
        raise exception '確認できない構造・権限: %.% をロックできません(SQLSTATE %)', t.schema_name, t.table_name, sqlstate;
    end;
  end loop;
  if exists (
    (select * from pg_temp.restore_catalog_tables except select * from pg_temp.restore_tables)
    union all
    (select * from pg_temp.restore_tables except select * from pg_temp.restore_catalog_tables)
  ) then
    raise exception '確認できない構造・権限: ロックの間に表の一覧が変わりました';
  end if;
end;
$$;

\echo 2. migrationの版を確かめます
do $$
declare
  v_missing text;
  v_extra text;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception '復元先のmigrationの版が取得と一致しません: migration履歴の表(supabase_migrations.schema_migrations)がありません';
  end if;
  select string_agg(d.version, ', ' order by d.version) into v_missing
  from (
    select jsonb_array_elements_text(i.manifest -> 'migration_versions') from pg_temp.restore_input i
    except
    select m.version::text from supabase_migrations.schema_migrations m
  ) as d (version);
  select string_agg(d.version, ', ' order by d.version) into v_extra
  from (
    select m.version::text from supabase_migrations.schema_migrations m
    except
    select jsonb_array_elements_text(i.manifest -> 'migration_versions') from pg_temp.restore_input i
  ) as d (version);
  if v_missing is not null or v_extra is not null then
    raise exception '復元先のmigrationの版が取得と一致しません(不足: %、余分: %)。取得の記録にある版のmigrationだけを適用してください',
      coalesce(v_missing, 'なし'), coalesce(v_extra, 'なし');
  end if;
end;
$$;

\echo 3. 復元先が空であることを確かめます
\i :check_empty_file

do $$
declare
  v_missing text;
begin
  select string_agg(k.name, ', ' order by k.name) into v_missing
  from pg_temp.restore_input i, jsonb_object_keys(i.manifest -> 'row_counts') as k (name)
  where not exists (
    select 1 from pg_temp.restore_tables t where array[t.schema_name, t.table_name] = parse_ident(k.name)
  );
  if v_missing is not null then
    raise exception '復元先に取得の表がありません: %', v_missing;
  end if;
end;
$$;

\echo 4. データを入れます
\o :writing_file
\qecho writing
\o /dev/null
do $$
declare
  v_tables text;
begin
  select string_agg(format('%I.%I', p.ident[1], p.ident[2]), ', ') into v_tables
  from pg_temp.restore_input i,
    jsonb_object_keys(i.manifest -> 'row_counts') as k (name),
    lateral (select parse_ident(k.name) as ident) as p;
  execute 'truncate table ' || v_tables;
end;
$$;
\i :data_file
-- data.sqlの設定(session_replication_role = replicaなど)を、確認と削除の前に通常へ戻す。
reset all;
set local session_replication_role = origin;
set local row_security = off;

\echo 5. 行数と参照を確かめます
set local search_path = '';
do $$
declare
  c record;
  v_actual bigint;
  v_failures text[] := '{}';
begin
  for c in
    select e.key as name, e.value::numeric as expected, parse_ident(e.key) as ident
    from pg_temp.restore_input i, jsonb_each_text(i.manifest -> 'row_counts') as e
    order by e.key
  loop
    execute format('select count(*) from %I.%I', c.ident[1], c.ident[2]) into v_actual;
    if v_actual <> c.expected then
      v_failures := v_failures || format('%s 取得 %s 復元 %s', c.name, c.expected, v_actual);
    end if;
  end loop;
  if cardinality(v_failures) > 0 then
    raise exception '行数が一致しません: %', array_to_string(v_failures, ', ');
  end if;
end;
$$;

do $$
declare
  c record;
  v_orphans bigint;
  v_failures text[] := '{}';
begin
  for c in
    select
      con.conname,
      con.conrelid::regclass as child,
      con.confrelid::regclass as parent,
      (select string_agg(format('c.%I is not null', a.attname), ' and ')
        from unnest(con.conkey) as k(attnum)
        join pg_catalog.pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as present,
      (select string_agg(format('p.%I = c.%I', pa.attname, ca.attname), ' and ')
        from unnest(con.conkey, con.confkey) as k(child_attnum, parent_attnum)
        join pg_catalog.pg_attribute ca on ca.attrelid = con.conrelid and ca.attnum = k.child_attnum
        join pg_catalog.pg_attribute pa on pa.attrelid = con.confrelid and pa.attnum = k.parent_attnum) as matches
    from pg_catalog.pg_constraint con
    where con.contype = 'f'
      and con.connamespace in ('public'::regnamespace, 'auth'::regnamespace)
  loop
    execute format(
      'select count(*) from %s c where %s and not exists (select 1 from %s p where %s)',
      c.child, c.present, c.parent, c.matches
    ) into v_orphans;
    if v_orphans > 0 then
      v_failures := v_failures || format('%s(%s): %s', c.conname, c.child, v_orphans);
    end if;
  end loop;
  if cardinality(v_failures) > 0 then
    raise exception '参照先の無い行があります: %', array_to_string(v_failures, ', ');
  end if;
end;
$$;
reset search_path;

\if :with_deletions
\echo 6. 削除の記録にある利用者を、削除の後の状態へ戻します
do $$
declare
  v_user_id uuid;
  v_remaining bigint;
begin
  for v_user_id in select unnest(i.deletion_ids) from pg_temp.restore_input i
  loop
    perform public.purge_account(v_user_id);
  end loop;
  select count(*) into v_remaining
  from auth.users u, pg_temp.restore_input i
  where u.id = any (i.deletion_ids);
  if v_remaining > 0 then
    raise exception '削除の記録にある利用者が % 人残っています', v_remaining;
  end if;
end;
$$;
\else
\echo 6. 削除の記録の一覧が指定されていないため、削除の後の状態へ戻す段階を行いません
\endif

\echo 7. 確定します
commit;
SQL
} >"$work/restore.sql"

with_deletions=false
if [[ -n $deletions_file ]]; then
  with_deletions=true
fi

# エラーの詳細(行の内容を含み得るDETAILとCONTEXT)は表示しない。
if ! psql "$DATABASE_URL" -X -q -o /dev/null -v ON_ERROR_STOP=1 -v VERBOSITY=terse \
  -v check_empty_file="$check_empty" -v data_file="$data" -v writing_file="$writing" -v with_deletions="$with_deletions" \
  -f "$work/restore.sql"; then
  if [[ -s $writing ]]; then
    fail "書き換えを始めた後に失敗したか、確定の成否が分かりません。この復元先は使わず公開もせず、docs/backup.mdの「失敗したとき」に従って、対象を確かめて破棄し、新しい空の復元先で最初からやり直してください。"
  fi
  fail "書き換えを始める前に止まりました。復元先のデータは変えていません。上の理由を確かめてください。"
fi
if [[ $with_deletions == true ]]; then
  echo "削除の記録の ${#deletion_ids[@]} 件を処理しました"
fi
echo "復元のDBの部分を終えました"
