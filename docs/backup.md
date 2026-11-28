# バックアップと復元

本番のDBをSupabaseの外に保管し、取得時点のデータを空のDBへ再現するための運用手順。

## 保証すること

- 保持しているバックアップから、[復元先の条件](#復元先の条件)を満たすSupabaseのDBへ、取得時点のDBのデータを復元できる。
  記録の`commit`に、適用済みのmigrationが1件でも無い取得(古いCDの再実行で取ったもの、履歴の書き換えをまたぐものなど)は対象外とする。
- 取得の後に削除されたアカウントは、復元先に適用した版の削除の処理の後と同じ状態になる(アカウントの行と、それに連なる認証手段とセッションが残らない)。
- 保証は空のDBへの再現までで、復元先をサインインやアプリで使える状態にすることと、本番への戻し方は含まない([本番へ戻すとき](#本番へ戻すとき))。

## 仕組み

| 項目 | 内容 |
| --- | --- |
| 何を | 本番のDBのデータ(アプリの`public`と、サインインに要る`auth`。Storageなどは対象外)、スキーマ、migration履歴、取得の記録(時刻、種類、commit、migrationの版、表ごとの行数) |
| いつ | 毎日(`.github/workflows/backup.yml`)と、migrationの適用の直前(`cd.yml`。取れなければ適用しない) |
| どこへ | Cloudflare R2の非公開のバケット`aims-backup`の`backups/<UTC時刻>-<scheduled\|pre-migration>.tar.gz.age` |
| 暗号化 | GitHub Actionsの中で`age`の公開鍵で暗号化する。秘密鍵は運営者の手元の2か所だけに置き、失うと全てのバックアップを復元できない |
| 保持 | 30日でR2のライフサイクルが消す。期間中はバケットロックで消せない |
| 削除の記録 | `delete_account`が、削除と同じトランザクションでWorker(`apps/account-deletion-log/`)を通して`deletions/<利用者ID>`に書く。書けなければ削除しない。中身と保持期間は`docs/features/auth/delete-account/requirements.md`の「削除される記録」に従う |
| 通知 | 失敗はGitHubの通知で、失敗と1日を過ぎた未実行はHealthchecks.ioのメールで運営者に届く |
| 適用するmigration | `scripts/backup/prepare-restore.py`が、取得の記録の版のファイルだけを記録の`commit`から取り出す。状態(適用の前後、失敗後、一部適用)によらず同じ手順になる |
| DBの復元 | `scripts/backup/restore-db.sh`が、1つの接続の1つのトランザクションで、表の排他ロック、版の照合、空の確認、データの投入、行数と外部キーの確認、削除の記録の適用を行い、全て成功した場合だけ確定する |

## 設定の一覧

- GitHub Secrets: `BACKUP_R2_ACCESS_KEY_ID`、`BACKUP_R2_SECRET_ACCESS_KEY`、`BACKUP_HEALTHCHECK_PING_URL`。
- GitHub Variables: `BACKUP_R2_ENDPOINT`、`BACKUP_R2_BUCKET`、`BACKUP_AGE_RECIPIENT`(`age`の公開鍵)。
- 本番のVault: `account_deletion_log_endpoint`(WorkerのURL)、`account_deletion_log_key`(Workerの秘密`authKey`と同じ値)。

## 復元先の条件

復元先は、次の2つを満たすSupabaseのDBとする。
満たせば環境を問わず、接続先が本番かどうかと、接続の形式も問わない。

- 利用者や記録のデータが無い(migrationが作るデータはあってよい)。
- 取得に無いmigrationが適用されていない。

条件を満たさないDBは、手順3の前の確認と、手順4の版の照合と空の確認で止める。
同じ版で中身が違うmigrationが適用済みであることは、確かめない。

空の確認では、`public`と`auth`の全ての表が0行であることを`scripts/backup/check-empty.sql`が確かめる。
認証サービスの構造の管理の履歴`auth.schema_migrations`は対象外とする。
migrationが作る次の行は、あってよい。

- 公式の的とプリセット。固定のIDで見分け、プリセットは持ち主が無いことと、距離と公式の親の組も確かめる。
- 匿名化先の利用者。メール、認証情報、メタデータ、名前などが無いものに限る。

seedのテスト利用者があるDBは空ではない。
読めない表、ロックできない表、外部表など、確かめられないものがある場合も止まる。

## 復元

用意するもの:

- `age`の秘密鍵と、R2を読めるトークン。
- `age`、AWS CLI、`jq`、`psql`(17以上)、Python(3.11以上)、Supabase CLI(3.1.0)。
- 復元の作業に使う、最新のmainのclone。取得の`commit`を含むこと。
- [復元先の条件](#復元先の条件)を満たすSupabaseのDBの接続文字列(Session pooler)。

取得の`commit`はcheckoutせず、最新のcloneのルートで、そのcloneのスクリプトと文書に従う。
取得の`commit`から使うのはmigrationだけである。

1. 30日以内のバックアップを取り出して復号し、同時に削除の記録の一覧を取り出す(記録は保持期間を過ぎると消えるため)。

   ```sh
   aws s3api get-object --endpoint-url "$R2_ENDPOINT" --bucket aims-backup --key backups/<名前> backup.tar.gz.age
   mkdir backup && age -d -i <秘密鍵> backup.tar.gz.age | tar -C backup -xzf -
   rm -f deletions.txt && keys=$(aws s3api list-objects-v2 --endpoint-url "$R2_ENDPOINT" --bucket aims-backup --prefix deletions/ --query 'Contents[].Key' --output text) \
     && printf '%s\n' "$keys" | tr '\t' '\n' | sed -n 's|^deletions/||p' > deletions.txt
   ```

   削除の記録の一覧の取り出しに失敗すると`deletions.txt`は作られず、手順4は書き換え前に止まる。
   失敗の理由を確かめて、一覧を取り出し直す。

2. 取得の版のmigrationを、新しい一時領域へ準備する。
   取得の`commit`が無いと表示されたら、`git fetch origin <commit>`の後にやり直す。

   ```sh
   restore_work=$(mktemp -d)
   python3 scripts/backup/prepare-restore.py backup "$restore_work/migrations"
   ```

3. **接続先が利用者や記録の無い復元先であることを確かめてから**、migrationを適用する。
   接続先を誤ると、利用者や記録のあるDB(本番を含む)にもmigrationが適用される。

   ```sh
   export DATABASE_URL='<復元先の接続文字列>'
   supabase db push --workdir "$restore_work/migrations" --remote="$DATABASE_URL" --skip-vault --yes
   ```

   - 接続先はURLで指定し、`supabase link`の状態を使わない。
   - seedとrolesは適用せず、バックアップの`migrations.sql`も投入しない。
   - 途中で失敗した場合は、理由を確かめて同じコマンドを再実行する。DBは初期化しない。
   - 復元先の版が取得と合わないエラーは、`migration repair`と`--include-all`を使わず、別の復元先を使う。

4. データを復元する。削除の記録の一覧は必ず渡す。

   ```sh
   scripts/backup/restore-db.sh backup deletions.txt
   ```

   - 「復元のDBの部分を終えました」の表示で完了とする。失敗した場合は[失敗したとき](#失敗したとき)に従う。
   - 実行中は表を排他ロックする。誤って稼働中のDBを指定すると、空でないと分かって止まるまで、読み書きが一時的に止まることがある。

5. 手元の平文(`backup.tar.gz.age`、`backup/`、`deletions.txt`、`$restore_work`)と秘密鍵を消し、`DATABASE_URL`を解除する。
6. 本番へ戻すために使わない復元先は、使い終えたら破棄する。
   破棄は、復元で入れたデータを残さないことで、方法は問わない。

## 失敗したとき

| 状況 | 対応 |
| --- | --- |
| 手順4が書き換えの前に止まった(入力の不備は理由を表示する。接続の失敗、版の不一致、空でない、ロックできないなどは、理由と「書き換えを始める前に止まりました」を表示する) | 復元先のデータは変わっていない。対象を消去も破棄もせず、理由を確かめる。他の接続の利用でロックできない場合は、時間を置いて再実行する。版が合わず直せない場合は、別の空の復元先を使う |
| 手順4が書き換えを始めた後に失敗した、または確定の成否が分からない | 復元の完了した環境として使わず、公開もしない。対象を確かめて破棄し、空の復元先を用意し直して手順2からやり直す |

- 破棄は、利用者と削除したアカウントを含む、復元で入れたデータを残さないことで、方法は問わない。運営者が対象を確かめて行い、スクリプトは削除も初期化もしない。
- `db reset`や全消去のSQLでDBを空にしてやり直さない。データのある復元先への再実行は、空の確認で止まる。

## 本番へ戻すとき

本番への戻し方は、障害ごとに運営者が判断する。
次に注意する。

- アプリとデータの構造を合わせる。
- 取得の後に削除されたアカウントを復活させない。
- `supabase/config.toml`の接続先の変更をmainへ入れると、CDが起動し、`SUPABASE_PROD_PROJECT_ID`のプロジェクトへ未適用のmigrationが適用される。
- アプリを古い版へ戻すと、新しい版を使った端末で記録できない可能性がある。
- 復元前の新しい記録を持つ端末は、復元前の内容が表示され続ける。対処は端末のサイトのデータの削除で、未送信の記録は失われる。この対処の有効性は未確認である。
- 本番へ戻すには、接続先の設定(`SUPABASE_PROD_PROJECT_ID`、`supabase/config.toml`の`[remotes.production].project_id`、Vercelの`NEXT_PUBLIC_SUPABASE_URL`と`NEXT_PUBLIC_SUPABASE_ANON_KEY`)、Vaultの2件、認証設定の反映、Googleの戻り先の登録、サインインの確認が別に要る。

## 定期確認

- Healthchecks.ioのチェックがupで、R2の`backups/`に毎日の取得がある。
- R2の使用量が無料枠(10GB)に収まっている。
- 復元の仕組みは、CIの`DB Test`で`scripts/backup/tests/verify-restore.sh`が確かめる。
- migrationやワークフローを変えたら、この文書の復元手順と食い違っていないかを見る。
- 復元の処理、依存する表、`purge_account`を変えるときは、保持中の取得の構造でも、空の確認と復元が成り立つことを確かめる。
- 公式の的やプリセットの行を追加・変更するmigrationを足すときは、`scripts/backup/check-empty.sql`の固定のIDと親子の組に足す。保持中の取得の復元に要る旧IDと組は消さない。
