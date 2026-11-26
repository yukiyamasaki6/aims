# バックアップと復元

本番のDBをSupabaseの外に保管し、空のSupabaseのプロジェクトへ戻すための運用手順。

## 保証すること

- 保持しているどのバックアップからも、空のSupabaseのプロジェクトへ取得時点の状態を復元できる。
- 復元後、取得時点の利用者はサインインできる。
- 取得の後に削除されたアカウントは、復元後も削除の後と同じ状態で、サインインできない。

## 仕組み

| 項目 | 内容 |
| --- | --- |
| 何を | 本番のDBのデータ(`auth`を含む)、スキーマ、migration履歴、取得の記録(時刻、種類、commit、表ごとの行数) |
| いつ | 毎日(`.github/workflows/backup.yml`)と、migrationの適用の直前(`cd.yml`。取れなければ適用しない) |
| どこへ | Cloudflare R2の非公開のバケット`aims-backup`の`backups/<UTC時刻>-<scheduled\|pre-migration>.tar.gz.age` |
| 暗号化 | GitHub Actionsの中で`age`の公開鍵で暗号化する。秘密鍵は運営者の手元の2か所だけに置き、失うと全てのバックアップを復元できない |
| 保持 | 30日でR2のライフサイクルが消す。期間中はバケットロックで消せない |
| 削除の記録 | `delete_account`が、削除と同じトランザクションでWorker(`apps/account-deletion-log/`)を通して`deletions/<利用者ID>`に書く。書けなければ削除しない。中身と保持期間は`docs/features/auth/delete-account/requirements.md`の「削除される記録」に従う |
| 通知 | 失敗はGitHubの通知で、失敗と1日を過ぎた未実行はHealthchecks.ioのメールで運営者に届く |

## 設定の一覧

- GitHub Secrets: `BACKUP_R2_ACCESS_KEY_ID`、`BACKUP_R2_SECRET_ACCESS_KEY`、`BACKUP_HEALTHCHECK_PING_URL`。
- GitHub Variables: `BACKUP_R2_ENDPOINT`、`BACKUP_R2_BUCKET`、`BACKUP_AGE_RECIPIENT`(`age`の公開鍵)。
- 本番のVault: `account_deletion_log_endpoint`(WorkerのURL)、`account_deletion_log_key`(Workerの秘密`authKey`と同じ値)。

## 復元

用意するもの: `age`の秘密鍵、R2を読めるトークン、`age`・AWS CLI・`jq`・`psql`(17以上)・Supabase CLI、復元先のDBの接続文字列(Session pooler)。

1. 30日以内のバックアップを取り出して復号し、同時に削除の記録の一覧を取り出す(記録は保持期間を過ぎると消えるため)。

   ```sh
   aws s3api get-object --endpoint-url "$R2_ENDPOINT" --bucket aims-backup --key backups/<名前> backup.tar.gz.age
   mkdir backup && age -d -i <秘密鍵> backup.tar.gz.age | tar -C backup -xzf -
   aws s3api list-objects-v2 --endpoint-url "$R2_ENDPOINT" --bucket aims-backup --prefix deletions/ --query 'Contents[].Key' --output text \
     | tr '\t' '\n' | sed -n 's|^deletions/||p' > deletions.txt
   ```

2. `backup/manifest.json`の`commit`をcheckoutし、復元先にmigrationを適用する(`supabase link`の後に`supabase db push --yes --remote`)。
3. `DATABASE_URL=<接続文字列> scripts/backup/restore-db.sh backup deletions.txt`を実行する。
   版の一致、データの投入、行数と外部キーの確認、削除の記録の利用者への`purge_account`を順に行い、失敗したら止まる。再実行できる。
4. 新しいプロジェクトでは、本番のVaultの2件を`vault.create_secret`で置く。
5. `cd.yml`と同じ値で`supabase config push --yes`を行い、Googleの戻り先に`https://<復元先のID>.supabase.co/auth/v1/callback`があることを確かめる。
6. 本番を置き換えるときは、`SUPABASE_PROD_PROJECT_ID`、`supabase/config.toml`の`[remotes.production].project_id`、Vercelの`NEXT_PUBLIC_SUPABASE_URL`と`NEXT_PUBLIC_SUPABASE_ANON_KEY`を新しいプロジェクトに合わせる。
7. サインインできることと、削除の記録の利用者が以前のアカウントに入れないことを確かめ、手元の平文と秘密鍵を消す。

## 定期確認

- Healthchecks.ioのチェックがupで、R2の`backups/`に毎日の取得がある。
- R2の使用量が無料枠(10GB)に収まっている。
- 復元の仕組みは、CIの`DB Test`で`scripts/backup/tests/verify-restore.sh`が確かめる。
- migrationやワークフローを変えたら、この文書の復元手順と食い違っていないかを見る。
