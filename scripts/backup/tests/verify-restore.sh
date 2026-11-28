#!/usr/bin/env bash
# 復元の機構(docs/backup.md)を、ローカルのSupabaseの捨てDBで検証する。
# 未適用のmigrationを含むcommitを記録した取得(dump-db.sh)から、取得の版のmigrationだけを準備して(prepare-restore.py)
# 空のDBへ適用し、復元(restore-db.sh)する。取得の時点の状態へ戻ること、取得の後に削除したアカウントが削除の後と同じ状態になること、
# 射手の番号が保たれること、データのある復元先と取り違えを、データを変えずに止めることを確かめる。
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

# 指定したラウンドの射手の行(行のIDと番号)と、矢と矢の履歴の射手番号。
shooter_numbers() { # shooter_numbers <ラウンドIDの条件のSQL>
  psql_value "select concat_ws(' / ',
    (select string_agg(round_id || ':' || id || ':' || shooter_number, ',' order by round_id, shooter_number) from public.round_users where shooter_number is not null and round_id $1),
    (select string_agg(distance_id || ':' || end_number || ':' || shot_number || ':' || shooter_number, ',' order by distance_id, end_number, shot_number) from public.shots where round_id $1),
    (select string_agg(event_id || ':' || shooter_number, ',' order by event_id) from public.shot_events where round_id $1))"
}

# 出力は、失敗したときだけ表示する。
run_quietly() {
  if ! "$@" >"$work/command.log" 2>&1; then
    cat "$work/command.log" >&2
    return 1
  fi
}

migration_history_count() {
  if [[ $(psql_value "select to_regclass('supabase_migrations.schema_migrations') is null") == t ]]; then
    echo 0
  else
    psql_value "select count(*) from supabase_migrations.schema_migrations"
  fi
}

# 復元先を、取得の版のmigrationだけを適用した空の状態にする。適用は運用の手順(docs/backup.md)と同じコマンドで行う。
# 初期化(db reset)は、このCI専用のDBを空にするためだけに使う。
reset_empty() {
  echo "-- 空の復元先を用意する"
  run_quietly pnpm --silent exec supabase db reset --workdir "$work/empty" --no-seed
  check "適用の前の復元先に、migration履歴の行が無い" 0 "$(migration_history_count)"
  check "適用の前の復元先に、アプリの表が無い" t \
    "$(psql_value "select to_regclass('public.users') is null and to_regclass('public.rounds') is null")"
  run_quietly pnpm --silent exec supabase db push --workdir "$work/migrations" --remote="$database_url" --skip-vault --yes
  check "適用した版が、取得の記録の版と一致する" \
    "$(jq -r '.migration_versions | sort | join(",")' "$work/backup/manifest.json")" \
    "$(psql_value "select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations")"
  check "取得のcommitだけにある未適用のmigrationは、適用されない" t "$(psql_value "select to_regclass('public.verify_unapplied') is null")"
  check "適用の後の利用者は、匿名化先だけである" 00000000-0000-4000-8000-000000000001 \
    "$(psql_value "select string_agg(id::text, ',') from auth.users")"
}

# 取得の記録だけをjqの式で変えた取得を作り、そのディレクトリを返す。
altered_backup() { # altered_backup <ディレクトリ名> <jqの式>
  local dir=$work/$1
  mkdir "$dir"
  cp "$work/backup/data.sql" "$dir/"
  jq "$2" "$work/backup/manifest.json" >"$dir/manifest.json"
  echo "$dir"
}

# 失敗するはずの復元を行い、失敗すること、理由、データが変わらないことを確かめる。標準エラーは$work/restore.errに残る。
check_rejected() { # check_rejected <名前> <理由の文言> <restore-db.shの引数>...
  local name=$1 reason=$2 before status=0 reason_found=false
  shift 2
  before=$(snapshot)
  scripts/backup/restore-db.sh "$@" >/dev/null 2>"$work/restore.err" || status=$?
  if grep -qF -- "$reason" "$work/restore.err"; then
    reason_found=true
  fi
  check "$name: 復元は失敗する" true "$([[ $status -ne 0 ]] && echo true || echo false)"
  check "$name: 理由が分かる" true "$reason_found"
  if [[ $reason_found == false ]]; then
    cat "$work/restore.err" >&2
  fi
  check "$name: データは変わらない" "$before" "$(snapshot)"
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

echo "== 準備: 利用者5人(取得の後に削除する利用者と、削除が取り消される利用者を含む)と、記録を作る"
reset_db
keep_id=$(sign_in keep@example.test)
gone_id=$(sign_in gone@example.test)
gone2_id=$(sign_in gone2@example.test)
delegate_id=$(sign_in delegate@example.test)
cancelled_id=$(sign_in cancelled@example.test)
# 射つ人の検査はコミットの時点で働くため、1トランザクションで作る。
psql "$database_url" -X -q --single-transaction -v ON_ERROR_STOP=1 <<SQL
set search_path = public;
create temp table ids as select '$keep_id'::uuid as keep, '$gone_id'::uuid as gone, '$gone2_id'::uuid as gone2,
  '$delegate_id'::uuid as delegate, '$cancelled_id'::uuid as cancelled;
-- a1: keepだけのラウンド。b1: goneだけが射つ人のラウンド。
-- b2: 射つ人keep・gone・gone2、代理の人delegate、欠番(4)のある紐づかない射手5がいるラウンド。
-- b5: 射つ人keepとcancelledのラウンド(射手は1と4)。
insert into rounds (id, name, round_date, format, bow_type, status) values
  ('00000000-0000-4000-8000-0000000000a1', 'keep round', '2026-09-10', 'outdoor', 'recurve', 'in_progress'),
  ('00000000-0000-4000-8000-0000000000b1', 'gone solo', '2026-09-10', 'outdoor', 'recurve', 'completed'),
  ('00000000-0000-4000-8000-0000000000b2', 'gone shared', '2026-09-10', 'outdoor', 'recurve', 'completed'),
  ('00000000-0000-4000-8000-0000000000b5', 'cancelled shared', '2026-09-10', 'outdoor', 'recurve', 'completed');
insert into round_users (round_id, user_id, role, shooter_number)
select '00000000-0000-4000-8000-0000000000a1'::uuid, keep, 'owner', 1 from ids
union all select '00000000-0000-4000-8000-0000000000b1'::uuid, gone, 'owner', 1 from ids
union all select '00000000-0000-4000-8000-0000000000b2'::uuid, keep, 'owner', 1 from ids
union all select '00000000-0000-4000-8000-0000000000b2'::uuid, gone, 'owner', 2 from ids
union all select '00000000-0000-4000-8000-0000000000b2'::uuid, gone2, 'owner', 3 from ids
union all select '00000000-0000-4000-8000-0000000000b2'::uuid, delegate, 'editor', null from ids
union all select '00000000-0000-4000-8000-0000000000b2'::uuid, null, null, 5 from ids
union all select '00000000-0000-4000-8000-0000000000b5'::uuid, keep, 'owner', 1 from ids
union all select '00000000-0000-4000-8000-0000000000b5'::uuid, cancelled, 'owner', 4 from ids;
insert into distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked)
select d.id::uuid, d.round_id::uuid, 'a', 70, 12, 3, (select id from target_faces order by id limit 1), true
from (values
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000b1'),
  ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000b2'),
  ('00000000-0000-4000-8000-0000000000b6', '00000000-0000-4000-8000-0000000000b5')) as d(id, round_id);
insert into shots (round_id, distance_id, end_number, shot_number, shooter_number, score_str, score_int)
select d.round_id, d.id, 1, v.shot_number, v.shooter_number, v.score::text, v.score
from (values
  ('00000000-0000-4000-8000-0000000000a2', 1, 1, 10),
  ('00000000-0000-4000-8000-0000000000b3', 1, 1, 9),
  ('00000000-0000-4000-8000-0000000000b4', 1, 2, 8),
  ('00000000-0000-4000-8000-0000000000b4', 2, 1, 7),
  ('00000000-0000-4000-8000-0000000000b4', 3, 3, 6),
  ('00000000-0000-4000-8000-0000000000b6', 1, 4, 5)) as v(distance_id, shot_number, shooter_number, score)
join distances d on d.id = v.distance_id::uuid;
-- 操作者は、b2のマス1(射手2)がgone、マス2がgone2、マス3がdelegate、b6がcancelled。
insert into shot_events (event_id, round_id, distance_id, type, author_id, revision, end_number, shooter_number, score_str, score_int, shot_number, set_fields)
select v.event_id::uuid, d.round_id, d.id, 'RECORDED', v.author, 1, 1, v.shooter_number, v.score::text, v.score, v.shot_number, array['score', 'shooter_number']
from ids
cross join lateral (values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b4', ids.gone, 1, 2, 8),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000b4', ids.gone2, 2, 3, 7),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000b4', ids.delegate, 3, 3, 6),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000b6', ids.cancelled, 1, 4, 5)
) as v(event_id, distance_id, author, shot_number, shooter_number, score)
join distances d on d.id = v.distance_id::uuid;
insert into preset_rounds (id, owner_id, name, format, bow_type)
select '00000000-0000-4000-8000-0000000000d1'::uuid, gone, 'gone preset', 'outdoor', 'recurve' from ids;
SQL
before_all=$(snapshot)
surviving="<> '00000000-0000-4000-8000-0000000000b1'"
numbers_before=$(shooter_numbers "$surviving")
users_before=$(psql_value "select count(*) from auth.users")

# 取得に記録するcommitは、取得元へまだ適用していないmigrationを含む(migrationの適用の直前の取得の形)。
# その後のcommitでmigrationを消し、準備がHEADや作業ツリーではなく、記録のcommitを読むことを確かめる。
backup_repo=$work/repo
temp_git() {
  git -C "$backup_repo" -c user.name=verify -c user.email=verify@example.test -c commit.gpgsign=false -c core.hooksPath=/dev/null "$@"
}
mkdir -p "$backup_repo/supabase" "$backup_repo/scripts/backup"
cp -r supabase/migrations "$backup_repo/supabase/"
cp scripts/backup/prepare-restore.py "$backup_repo/scripts/backup/"
# 版は、以後に足すmigrationより新しいままにするため、遠い未来の値にする。
echo 'create table public.verify_unapplied (id integer);' >"$backup_repo/supabase/migrations/29980101000000_verify_unapplied.sql"
temp_git init -q
temp_git add .
temp_git commit -qm "add unapplied migration"
backup_commit=$(temp_git rev-parse HEAD)
temp_git rm -qr supabase/migrations
temp_git commit -qm "remove migrations"

echo "== 取得"
BACKUP_COMMIT=$backup_commit scripts/backup/dump-db.sh "$work/backup" >/dev/null
manifest_tables=$(jq -r '.row_counts | length' "$work/backup/manifest.json")
check "取得の記録に表ごとの行数が入っている" true "$([[ $manifest_tables -ge 20 ]] && echo true || echo false)"
check "取得の記録のauth.usersの行数が、取得したDBの行数と一致する" "$users_before" "$(jq -r '.row_counts["\"auth\".\"users\""]' "$work/backup/manifest.json")"
check "取得物はpublicとauthの表だけを含む" 0 "$(jq '[.row_counts | keys[] | select(test("^\"(public|auth)\"\\.") | not)] | length' "$work/backup/manifest.json")"

echo "== 取得の後にgone、gone2の順に削除した状態(期待)を作る"
psql_value "select public.purge_account('$gone_id')" >/dev/null
psql_value "select public.purge_account('$gone2_id')" >/dev/null
expected_after_delete=$(snapshot)
check "削除の後も、残るラウンドの射手の行のIDと番号、矢と履歴の射手番号は変わらない" "$numbers_before" "$(shooter_numbers "$surviving")"
# 削除の記録は、実行と逆の順に並べる。
printf '%s\n' "$gone2_id" "$gone_id" >"$work/deletions.txt"

echo "== 取得の版のmigrationを準備する"
(cd "$backup_repo" && python3 scripts/backup/prepare-restore.py "$work/backup" "$work/migrations") >/dev/null
# 空の復元先を作るための作業ディレクトリ。起動中のローカルの設定だけを持ち、migrationとseedを持たない。
mkdir -p "$work/empty/supabase"
cp -r supabase/config.toml supabase/templates "$work/empty/supabase/"

echo "== 復元(削除の記録なし)は、取得の時点の状態に戻す"
reset_empty
scripts/backup/restore-db.sh "$work/backup" >/dev/null
check "復元(削除の記録なし)の後の全記録が、取得の時点と一致する" "$before_all" "$(snapshot)"

echo "== データのある復元先は、書き換えずに止める"
# 取得に無い状態を作る。入れ直した後に失敗する誤りは、同じ内容に戻ると指紋で気付けないためである。
psql_value "update public.rounds set name = 'changed after restore' where id = '00000000-0000-4000-8000-0000000000a1'" >/dev/null
check_rejected "データのある復元先への再実行" "空でない表" "$work/backup" "$work/deletions.txt"
check "データのある復元先で止まったとき、理由の表示にメールアドレスが出ない" 0 "$(grep -c '@example\.test' "$work/restore.err" || true)"

echo "== migrationの版の取り違えを止める"
reset_empty
extra_version=$(altered_backup extra-version '.migration_versions += ["29990101000000"]')
check_rejected "復元先に足りない版がある" "migrationの版が取得と一致しません" "$extra_version"
missing_version=$(altered_backup missing-version '.migration_versions |= (sort | .[:-1])')
check_rejected "復元先に余分な版がある" "migrationの版が取得と一致しません" "$missing_version"

echo "== 行数の取り違えは、確定せずに止める"
reset_empty
count_mismatch=$(altered_backup count-mismatch '.row_counts["\"public\".\"users\""] += 1')
check_rejected "取得の記録と行数が違う" "行数が一致しません" "$count_mismatch"

echo "== 復元(削除の記録あり)は、削除の後と同じ状態にする"
reset_empty
scripts/backup/restore-db.sh "$work/backup" "$work/deletions.txt" >/dev/null
check "復元(削除の記録あり)の後の全記録が、取得の後に削除した状態と一致する" "$expected_after_delete" "$(snapshot)"

echo "== 削除の記録だけが残り、削除が取り消された利用者を含めて復元する"
reset_empty
printf '%s\n' "$cancelled_id" "$gone2_id" "$gone_id" >"$work/deletions-with-cancelled.txt"
scripts/backup/restore-db.sh "$work/backup" "$work/deletions-with-cancelled.txt" >/dev/null
check "削除が取り消された利用者の射手は、紐づけと役割だけが外れる" "4:-:-" \
  "$(psql_value "select shooter_number || ':' || coalesce(user_id::text, '-') || ':' || coalesce(role, '-') from public.round_users where round_id = '00000000-0000-4000-8000-0000000000b5' and shooter_number = 4")"
check "全ての射手の行のIDと番号、矢と履歴の射手番号は、取得の時点と同じである" "$numbers_before" "$(shooter_numbers "$surviving")"

echo "== 復元した利用者のサインイン"
keep_again=$(sign_in keep@example.test)
check "取得時点の利用者が、メールOTPで同じ利用者IDのままサインインできる" "$keep_id" "$keep_again"
gone_again=$(sign_in gone@example.test)
check "削除した利用者のメールアドレスは、旧データを引き継がない新しい利用者になる" true "$([[ $gone_again != "$gone_id" ]] && echo true || echo false)"

if ((failures > 0)); then
  echo "失敗: $failures 件" >&2
  exit 1
fi
echo "復元の機構の検証を終えました"
