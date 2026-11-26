#!/usr/bin/env bash
# DBの取得(docs/backup.md)。データ・スキーマ・migration履歴と取得の記録を、出力先のディレクトリに平文で置く。
# 暗号化と保管は呼び出し側(.github/actions/backup-prod-db)が行う。
#
# 使い方: scripts/backup/dump-db.sh <出力先のディレクトリ> [--remote]
#   --remote: linkしたプロジェクトから取る(本番の取得)。省略するとローカルのDBから取る(復元の手順の確認)
# 環境変数:
#   BACKUP_KIND    取得の種類。scheduled、pre-migration、local(既定)
#   BACKUP_COMMIT  取得したときのcommit。既定はgitのHEAD
#   SUPABASE_CLI   Supabase CLIのコマンド。既定はPATHのsupabase、無ければリポジトリのnode_modules/.bin/supabase
#
# 出力:
#   data.sql        データ(--data-only --use-copy)。アプリのpublicと、サインインに要るauthだけ。
#                   storageなどSupabaseが管理するスキーマは対象外(Storageは使わず、復元先の接続のロールは書き込めない)
#   schema.sql      スキーマ(照合用。復元はmigrationで作る)
#   migrations.sql  migration履歴(supabase_migrations)
#   manifest.json   取得の記録(取得時刻、種類、commit、migrationの版、表ごとの行数)
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
out=${1:?出力先のディレクトリを指定してください}
target=()
if [[ ${2:-} == --remote ]]; then
  target=(--remote)
fi

supabase_cli=${SUPABASE_CLI:-}
if [[ -z $supabase_cli ]]; then
  if command -v supabase >/dev/null; then
    supabase_cli=supabase
  else
    supabase_cli=$repo_root/node_modules/.bin/supabase
  fi
fi

umask 077
mkdir -p "$out"
out=$(cd "$out" && pwd)

# migration履歴の版を、migrations.sqlのschema_migrationsの行から読む。
migration_versions() {
  awk '
    /^COPY "supabase_migrations"."schema_migrations" / { inside = 1; next }
    inside && $0 == "\\." { inside = 0; next }
    inside { split($0, fields, "\t"); print fields[1] }
  ' "$1" | sort
}

# 表ごとの行数を、data.sqlのCOPYの行から数える。COPYの書式では1行が1行に当たる(値の中の改行は\nになる)。
row_counts() {
  awk '
    /^COPY / { table = $2; count = 0; inside = 1; next }
    inside && $0 == "\\." { print table "\t" count; inside = 0; next }
    inside { count++ }
  ' "$1"
}

taken_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cd "$repo_root"

# データの取得の前後でmigration履歴を取り、違えば失敗にする。取得の間に適用されたmigrationと、データの版がずれないため。
"$supabase_cli" db dump "${target[@]}" --data-only --use-copy --schema supabase_migrations -f "$out/migrations.sql"
"$supabase_cli" db dump "${target[@]}" --data-only --use-copy --schema public,auth -f "$out/data.sql"
"$supabase_cli" db dump "${target[@]}" -f "$out/schema.sql"
"$supabase_cli" db dump "${target[@]}" --data-only --use-copy --schema supabase_migrations -f "$out/migrations-after.sql"
if [[ $(migration_versions "$out/migrations.sql") != $(migration_versions "$out/migrations-after.sql") ]]; then
  echo "取得の間にmigrationが適用されました。取得をやり直してください。" >&2
  exit 1
fi
rm -f "$out/migrations-after.sql"

versions=$(migration_versions "$out/migrations.sql")
counts=$(row_counts "$out/data.sql")
if [[ -z $versions || -z $counts ]]; then
  echo "migration履歴か、データの表がありません。" >&2
  exit 1
fi

jq -n \
  --arg taken_at "$taken_at" \
  --arg kind "${BACKUP_KIND:-local}" \
  --arg commit "${BACKUP_COMMIT:-$(git -C "$repo_root" rev-parse HEAD)}" \
  --arg versions "$versions" \
  --arg counts "$counts" \
  '{
    format: 1,
    taken_at: $taken_at,
    kind: $kind,
    commit: $commit,
    migration_versions: ($versions | split("\n")),
    row_counts: ($counts | split("\n") | map(split("\t") | {key: .[0], value: (.[1] | tonumber)}) | from_entries)
  }' >"$out/manifest.json"

echo "取得しました: 表 $(wc -l <<<"$counts")、migration $(wc -l <<<"$versions")"
