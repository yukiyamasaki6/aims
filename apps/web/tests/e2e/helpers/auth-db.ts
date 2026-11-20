import { Client } from "pg";

// ローカルのテスト用DBだけに接続する。ホストが手元でなければ、本番へ向けた書き換えを避けるため実行しない。
const LOCAL_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

async function withLocalDb<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.E2E_DATABASE_URL ?? LOCAL_DATABASE_URL;
  const url = new URL(connectionString);
  // `?host=`などのクエリは、検査したホストと別の接続先へ向けられるため認めない。
  if (!LOCAL_HOSTS.has(url.hostname) || url.search !== "")
    throw new Error(
      "E2Eのテスト用DBは、クエリを含まないローカルのホストの接続文字列だけを使える。",
    );
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

// 実Authの送信間隔は、利用者の送信時刻の列(確認済みの既存利用者へのOTPは`recovery_sent_at`、登録は`confirmation_sent_at`、メール変更は`email_change_sent_at`)で判定される。実時間を待たず、次の送信が通る状態にする。
export function resetOtpSendInterval(email: string) {
  return withLocalDb((client) =>
    client.query(
      `update auth.users
          set recovery_sent_at = null,
              confirmation_sent_at = null,
              email_change_sent_at = null
        where email = $1`,
      [email],
    ),
  );
}

// 削除RPCが見るOTPの証跡(JWTのamrのtimestamp)は、更新時にセッションのamrの記録から作られる。
// 記録を過去へ戻してから更新すると、60秒を超えて古い証跡のJWTが得られる。実時間の経過そのものは確かめない。
export function backdateOtpEvidence(email: string) {
  return withLocalDb((client) =>
    client.query(
      `update auth.mfa_amr_claims
          set created_at = created_at - interval '2 minutes',
              updated_at = updated_at - interval '2 minutes'
        where session_id in (
          select s.id from auth.sessions s
            join auth.users u on u.id = s.user_id
           where u.email = $1)`,
      [email],
    ),
  );
}
