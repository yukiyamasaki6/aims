#!/usr/bin/env bash
# 復元の機構(docs/backup.md)を、ローカルのSupabaseの捨てDBで検証する。
# 取得(dump-db.sh)→DBの初期化→復元(restore-db.sh)を行い、取得の時点の状態へ戻ること、
# 取得の後に削除したアカウントが削除の後と同じ状態になること、手順が繰り返せること、取り違えを止めることを確かめる。
# 本番・外部サービスは使わない。ローカルのDBの中身は入れ替わり、成否にかかわらず最後にpnpm db:resetで初期状態へ戻す。
# CIでは、DBテストのジョブ(.github/workflows/ci.ymlのDB Test)で実行する。
#
# 使い方: pnpm db:start の後に scripts/backup/tests/verify-restore.sh(取得と復元の運用スクリプトは scripts/backup/ にある)
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$repo_root"

api_url=${VERIFY_API_URL:-http://127.0.0.1:54321}
mailpit_url=${VERIFY_MAILPIT_URL:-http://127.0.0.1:54324}
database_url=${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}
anon_key=$(pnpm --silent exec supabase status -o env | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')
[[ -n $anon_key ]] || { echo "ローカルのSupabaseが起動していません(pnpm db:start)" >&2; exit 1; }

work=$(mktemp -d)
export DATABASE_URL=$database_url

failures=0
check() { # check <名前> <期待> <実際>
  if [[ $2 == "$3" ]]; then
    echo "ok   $1"
  else
    echo "FAIL $1: 期待 [$2] 実際 [$3]" >&2
    failures=$((failures + 1))
  fi
}

psql_value() {
  psql "$database_url" -X -At -v ON_ERROR_STOP=1 -c "$1"
}

# 更新日時(更新のたびに現在時刻になる列)を除いた、認証とpublicの全ての行の指紋。
snapshot() {
  local result="" table
  for table in auth.users auth.identities auth.sessions auth.refresh_tokens \
    $(psql_value "select 'public.' || tablename from pg_tables where schemaname = 'public' order by 1"); do
    result+="$table="
    result+=$(psql_value "select md5(coalesce(string_agg((to_jsonb(r) - 'updated_at')::text, ',' order by (to_jsonb(r) - 'updated_at')::text), '')) from $table r")
    result+=$'\n'
  done
  echo "$result"
}

reset_db() {
  pnpm --silent db:reset >/dev/null 2>&1
}

# 失敗や中断のときも、作業の平文を消し、DBを初期状態へ戻す。終了コードは元のまま返す。
cleanup() {
  local status=$?
  rm -rf "$work"
  reset_db || echo "DBを初期状態へ戻せませんでした(pnpm db:reset)" >&2
  exit "$status"
}
trap cleanup EXIT

# メールOTPでサインインする(利用者が居なければ登録される)。利用者IDを返す。
# Turnstileは、ローカルの公式テストキーが通す固定の値を使う。
sign_in() {
  local email=$1 code
  curl -fsS -X POST "$api_url/auth/v1/otp" -H "apikey: $anon_key" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"create_user\":true,\"gotrue_meta_security\":{\"captcha_token\":\"XXXX.DUMMY.TOKEN.XXXX\"}}" >/dev/null
  local message_id=""
  for _ in $(seq 1 30); do
    message_id=$(curl -fsS "$mailpit_url/api/v1/search?query=$(jq -rn --arg q "to:$email" '$q|@uri')" | jq -r '.messages[0].ID // empty')
    [[ -n $message_id ]] && break
    sleep 0.5
  done
  [[ -n $message_id ]] || { echo "認証コードのメールが届きません: $email" >&2; return 1; }
  code=$(curl -fsS "$mailpit_url/api/v1/message/$message_id" | jq -r '.HTML' | grep -oE '(^|>)[[:space:]]*[0-9]{6}[[:space:]]*(<|$)' | grep -oE '[0-9]{6}' | head -1)
  curl -fsS -X DELETE "$mailpit_url/api/v1/messages" -d "{\"IDs\":[\"$message_id\"]}" -H 'Content-Type: application/json' >/dev/null
  curl -fsS -X POST "$api_url/auth/v1/verify" -H "apikey: $anon_key" -H 'Content-Type: application/json' \
    -d "{\"type\":\"email\",\"email\":\"$email\",\"token\":\"$code\"}" | jq -r '.user.id'
}

echo "== 準備: 利用者3人(取得の後に削除する利用者を含む)と、記録を作る"
reset_db
keep_id=$(sign_in keep@example.test)
gone_id=$(sign_in gone@example.test)
shared_id=$(sign_in shared@example.test)
psql "$database_url" -X -q -v ON_ERROR_STOP=1 <<SQL
set search_path = public;
create temp table ids as select '$keep_id'::uuid as keep, '$gone_id'::uuid as gone, '$shared_id'::uuid as shared;
-- gone: 自分だけのラウンドと、shared(他の編集者)と共有するラウンド。keep: 自分だけのラウンド。
insert into rounds (id, name, round_date, format, bow_type, status) values
  ('00000000-0000-4000-8000-0000000000a1', 'keep round', '2026-09-10', 'outdoor', 'recurve', 'in_progress'),
  ('00000000-0000-4000-8000-0000000000b1', 'gone solo', '2026-09-10', 'outdoor', 'recurve', 'completed'),
  ('00000000-0000-4000-8000-0000000000b2', 'gone shared', '2026-09-10', 'outdoor', 'recurve', 'completed');
insert into round_users (round_id, user_id, role)
select '00000000-0000-4000-8000-0000000000a1'::uuid, keep, 'editor' from ids
union all select '00000000-0000-4000-8000-0000000000b1'::uuid, gone, 'editor' from ids
union all select '00000000-0000-4000-8000-0000000000b2'::uuid, gone, 'editor' from ids
union all select '00000000-0000-4000-8000-0000000000b2'::uuid, shared, 'editor' from ids;
insert into distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked)
select d.id::uuid, d.round_id::uuid, 'a', 70, 12, 3, (select id from target_faces order by id limit 1), true
from (values
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000b1'),
  ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000b2')) as d(id, round_id);
insert into shots (distance_id, end_number, shot_number, shooter_id, score_str, score_int)
select '00000000-0000-4000-8000-0000000000a2'::uuid, 1, 1, keep, '10', 10 from ids
union all select '00000000-0000-4000-8000-0000000000b3'::uuid, 1, 1, gone, '9', 9 from ids
union all select '00000000-0000-4000-8000-0000000000b4'::uuid, 1, 1, gone, '8', 8 from ids
union all select '00000000-0000-4000-8000-0000000000b4'::uuid, 1, 2, shared, '7', 7 from ids;
insert into shot_events (event_id, distance_id, type, author_id, revision, end_number, shooter_id, score_str, score_int, shot_number, set_fields)
select '00000000-0000-4000-8000-0000000000c1'::uuid, '00000000-0000-4000-8000-0000000000b4', 'RECORDED', gone, 1, 1, gone, '8', 8, 1, array['score', 'shooter_id'] from ids;
insert into preset_rounds (id, owner_id, name, format, bow_type)
select '00000000-0000-4000-8000-0000000000d1'::uuid, gone, 'gone preset', 'outdoor', 'recurve' from ids;
SQL
before_all=$(snapshot)
users_before=$(psql_value "select count(*) from auth.users")

echo "== 取得"
scripts/backup/dump-db.sh "$work/backup" >/dev/null
manifest_tables=$(jq -r '.row_counts | length' "$work/backup/manifest.json")
check "取得の記録に表ごとの行数が入っている" true "$([[ $manifest_tables -ge 20 ]] && echo true || echo false)"
check "取得の記録のauth.usersの行数が、取得したDBの行数と一致する" "$users_before" "$(jq -r '.row_counts["\"auth\".\"users\""]' "$work/backup/manifest.json")"
check "取得物はpublicとauthの表だけを含む" 0 "$(jq '[.row_counts | keys[] | select(test("^\"(public|auth)\"\\.") | not)] | length' "$work/backup/manifest.json")"

echo "== 取得の後にgoneを削除した状態(期待)を作る"
psql_value "select public.purge_account('$gone_id')" >/dev/null
expected_after_delete=$(snapshot)
printf '%s\n' "$gone_id" >"$work/deletions.txt"

echo "== 復元(削除の記録なし)は、取得の時点の状態に戻す"
reset_db
scripts/backup/restore-db.sh "$work/backup" >/dev/null
check "復元(削除の記録なし)の後の全記録が、取得の時点と一致する" "$before_all" "$(snapshot)"

echo "== 復元(削除の記録あり)は、削除の後と同じ状態にする"
# 空のDBから削除の記録ありで復元する、運営者の実際の手順に近い経路を確かめるため、復元の前に初期化する。
reset_db
scripts/backup/restore-db.sh "$work/backup" "$work/deletions.txt" >/dev/null
check "復元(削除の記録あり)の後の全記録が、取得の後に削除した状態と一致する" "$expected_after_delete" "$(snapshot)"

echo "== 手順は繰り返せる"
scripts/backup/restore-db.sh "$work/backup" "$work/deletions.txt" >/dev/null
check "同じ手順をもう一度行っても、全記録が変わらない" "$expected_after_delete" "$(snapshot)"

echo "== 対象外のスキーマの表を飛ばす"
# 以前の取得物はstorageの表を含み、本番の復元先では書き込めずに止まった。ローカルはStorageが無効で再現しないため、対象外の表を足して確かめる。
mkdir -p "$work/out-of-scope" && cp "$work/backup/data.sql" "$work/out-of-scope/"
printf 'COPY "storage"."buckets_vectors" ("id") FROM stdin;\nout-of-scope\n\\.\n' >>"$work/out-of-scope/data.sql"
jq '.row_counts["\"storage\".\"buckets_vectors\""] = 1' "$work/backup/manifest.json" >"$work/out-of-scope/manifest.json"
if scripts/backup/restore-db.sh "$work/out-of-scope" "$work/deletions.txt" >/dev/null 2>&1; then status=0; else status=$?; fi
check "取得物にpublicとauth以外の表があっても、それを飛ばして復元できる" 0 "$status"
check "対象外の表を飛ばした復元の後も、全記録が削除の後の状態と一致する" "$expected_after_delete" "$(snapshot)"

echo "== 取り違えを止める"
jq '.migration_versions += ["29990101000000"]' "$work/backup/manifest.json" >"$work/mismatch-versions.json"
mkdir -p "$work/version-mismatch" && cp "$work/backup/data.sql" "$work/version-mismatch/" && cp "$work/mismatch-versions.json" "$work/version-mismatch/manifest.json"
if scripts/backup/restore-db.sh "$work/version-mismatch" >/dev/null 2>&1; then status=0; else status=$?; fi
check "migrationの版が取得と違うと、復元は失敗する" 1 "$status"
check "版の不一致で止まったとき、データは変わらない" "$expected_after_delete" "$(snapshot)"

echo "== 復元した利用者のサインイン"
keep_again=$(sign_in keep@example.test)
check "取得時点の利用者が、メールOTPで同じ利用者IDのままサインインできる" "$keep_id" "$keep_again"
gone_again=$(sign_in gone@example.test)
check "削除した利用者のメールアドレスは、旧データを引き継がない新しい利用者になる" true "$([[ $gone_again != "$gone_id" ]] && echo true || echo false)"

# 行数の確認は、データを入れた後に行う。失敗したときは、削除の記録を適用していない状態でDBに残るため、最後に行う。
jq '.row_counts["\"public\".\"users\""] += 1' "$work/backup/manifest.json" >"$work/mismatch-counts.json"
mkdir -p "$work/count-mismatch" && cp "$work/backup/data.sql" "$work/count-mismatch/" && cp "$work/mismatch-counts.json" "$work/count-mismatch/manifest.json"
if scripts/backup/restore-db.sh "$work/count-mismatch" >/dev/null 2>&1; then status=0; else status=$?; fi
check "取得の記録と行数が違うと、復元は失敗する" 1 "$status"

if ((failures > 0)); then
  echo "失敗: $failures 件" >&2
  exit 1
fi
echo "復元の機構の検証を終えました"
