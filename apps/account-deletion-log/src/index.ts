// 削除の記録のWorker(docs/backup.md)の入口。Cloudflare Workersの束縛を本体の依存へ渡す。
// 配備は `npx wrangler@4 deploy`、鍵は `npx wrangler@4 secret put authKey` で行う。名前は docs/backup.md の「設定の一覧」。
import {
  type DeletionLogBucket,
  recordAccountDeletion,
} from "./account-deletion-log";

// wrangler.tomlの束縛(bucket)と、wrangler secret putで登録する鍵(authKey)。
type Env = {
  bucket: DeletionLogBucket;
  authKey?: string;
};

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return recordAccountDeletion(request, {
      bucket: env.bucket,
      authKey: env.authKey,
      now: () => new Date(),
    });
  },
};
