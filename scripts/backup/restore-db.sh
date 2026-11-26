#!/usr/bin/env bash
# 復元(docs/backup.md)のDBの部分。取得(dump-db.sh)の出力を、migrationを適用済みのDBへ入れ、確かめる。
# 手順の全体と前提は docs/backup.md に従う。
#
# 使い方: DATABASE_URL=<復元先の接続文字列> scripts/backup/restore-db.sh <取得の出力のディレクトリ> [削除の記録の利用者IDの一覧]
#   利用者IDの一覧は、1行に1つの利用者ID(R2のdeletions/のオブジェクト名から接頭を除いたもの)。省略すると削除の後の状態へ戻す段階を行わない
#
# 段階(どれかが失敗したら、そこで止まる):
#   1. 復元先のmigration履歴の版が、取得の記録と一致することを確かめる
#   2. 取得にある表を空にしてから(migrationとシードが入れた行を消す)、トリガーと外部キーの検査を止めてデータを入れる(1トランザクション)
#   3. 各表の行数が取得の記録と一致し、外部キーごとに参照先の無い行が0であることを確かめる
#   4. 削除の記録にある利用者を、purge_accountで削除の後の状態へ戻す(居なければ何もしない)
set -euo pipefail

backup_dir=${1:?取得の出力のディレクトリを指定してください}
deletions_file=${2:-}
: "${DATABASE_URL:?DATABASE_URLに復元先の接続文字列を指定してください}"

manifest=$backup_dir/manifest.json
data=$backup_dir/data.sql
for file in "$manifest" "$data"; do
  [[ -f $file ]] || { echo "ありません: $file" >&2; exit 1; }
done

run_psql() {
  psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"
}

echo "1. migrationの版を確かめます"
expected_versions=$(jq -r '.migration_versions[]' "$manifest" | sort)
actual_versions=$(run_psql -At -c "select version from supabase_migrations.schema_migrations" | sort)
if [[ $expected_versions != "$actual_versions" ]]; then
  echo "復元先のmigrationの版が取得と一致しません。取得のcommit($(jq -r .commit "$manifest"))のmigrationを適用してください。" >&2
  diff <(echo "$expected_versions") <(echo "$actual_versions") >&2 || true
  exit 1
fi

echo "2. データを入れます"
tables=$(grep -oE '^COPY [^ ]+' "$data" | cut -d' ' -f2 | paste -sd, -)
run_psql --single-transaction -o /dev/null -c "TRUNCATE $tables" -f "$data"

echo "3. 行数と参照を確かめます"
mismatches=0
while IFS=$'\t' read -r table expected; do
  actual=$(run_psql -At -c "select count(*) from $table")
  if [[ $actual != "$expected" ]]; then
    echo "行数が一致しません: $table 取得 $expected 復元 $actual" >&2
    mismatches=$((mismatches + 1))
  fi
done < <(jq -r '.row_counts | to_entries[] | "\(.key)\t\(.value)"' "$manifest")
if ((mismatches > 0)); then
  exit 1
fi

run_psql <<'SQL'
set search_path = '';
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
SQL

if [[ -z $deletions_file ]]; then
  echo "4. 削除の記録の一覧が指定されていないため、削除の後の状態へ戻す段階を行いません"
  echo "復元のDBの部分を終えました"
  exit 0
fi

echo "4. 削除の記録にある利用者を、削除の後の状態へ戻します"
uuid_pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
statements=""
count=0
while read -r user_id; do
  [[ -z $user_id ]] && continue
  if [[ ! $user_id =~ $uuid_pattern ]]; then
    echo "利用者IDの形ではありません: $user_id" >&2
    exit 1
  fi
  statements+="select public.purge_account('$user_id'::uuid);"$'\n'
  count=$((count + 1))
done <"$deletions_file"
if ((count > 0)); then
  run_psql --single-transaction -At -o /dev/null -c "$statements"
fi
remaining=0
if ((count > 0)); then
  ids=$(grep -E "$uuid_pattern" "$deletions_file" | sed "s/.*/'&'::uuid/" | paste -sd, -)
  remaining=$(run_psql -At -c "select count(*) from auth.users where id in ($ids)")
fi
if ((remaining > 0)); then
  echo "削除の記録にある利用者が $remaining 人残っています" >&2
  exit 1
fi
echo "削除の記録の $count 件を処理しました"
echo "復元のDBの部分を終えました"
