import { randomUUID } from "node:crypto";
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

// 更新トークンが、認証サービスが持つそのセッションの現在のトークンかを、当該の利用者とセッションの行だけを読んで照合する。
// 照合できるのは、更新トークンを行で持つ方式だけである。回数で管理する方式のセッションと、対象の行が無いときは、照合せずに通さないため例外にする。
export function isCurrentRefreshToken(input: {
  userId: string;
  sessionId: string;
  refreshToken: string;
}): Promise<boolean> {
  const target = [input.sessionId, input.userId];
  return withLocalDb(async (client) => {
    const sessions = await client.query<{ counter: string | null }>(
      `select refresh_token_counter as counter
         from auth.sessions
        where id = $1 and user_id = $2`,
      target,
    );
    if (sessions.rows.length !== 1) throw new Error("no auth session row");
    if (sessions.rows[0].counter !== null)
      throw new Error("unsupported refresh token method");
    const current = await client.query<{ token: string }>(
      `select token
         from auth.refresh_tokens
        where session_id = $1 and user_id = $2 and revoked is false`,
      target,
    );
    if (current.rows.length !== 1)
      throw new Error("no single current refresh token row");
    return current.rows[0].token === input.refreshToken;
  });
}

export type GoogleLinkedUser = {
  id: string;
  email: string;
  // Googleの手段が持つアドレス。
  googleEmail: string;
};

// Googleで作った(または結び付けた)確認済みの利用者を、認証サービスの表へ直接入れる。実際のGoogleでの認証は、E2Eでは再現できない。
// emailIdentity: メールの手段も持つ(メールで作ってGoogleを追加した形)。持たないときは、Googleの手段だけを持つ(Googleで作った形)。
// googleEmail: Googleの手段だけに残るアドレス(メールアドレスの変更の後にGoogle側に残った形)。省略時はアカウントのアドレス。
// 認証サービスの列のうちトークンの列は、NULLだと認証サービスが500にするため空文字にする。
export function createGoogleLinkedUser(input: {
  email: string;
  emailIdentity: boolean;
  googleEmail?: string;
}): Promise<GoogleLinkedUser> {
  const id = randomUUID();
  const googleEmail = input.googleEmail ?? input.email;
  const googleSubject = randomUUID().replaceAll("-", "");
  const providers = input.emailIdentity ? ["email", "google"] : ["google"];
  return withLocalDb(async (client) => {
    await client.query("begin");
    try {
      await client.query(
        `insert into auth.users (
           instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
           raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
           confirmation_token, recovery_token, email_change_token_new, email_change,
           email_change_token_current, reauthentication_token, phone_change, phone_change_token
         ) values (
           '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '', now(),
           $3::jsonb, '{}'::jsonb, now(), now(),
           '', '', '', '', '', '', '', ''
         )`,
        [
          id,
          input.email,
          JSON.stringify({ provider: providers[0], providers }),
        ],
      );
      await client.query(
        `insert into auth.identities (
           id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
         ) values ($1, $2, $3, 'google', $4::jsonb, now(), now(), now())`,
        [
          randomUUID(),
          id,
          googleSubject,
          JSON.stringify({
            iss: "https://accounts.google.com",
            sub: googleSubject,
            email: googleEmail,
            email_verified: true,
          }),
        ],
      );
      if (input.emailIdentity)
        await client.query(
          `insert into auth.identities (
             id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
           ) values ($1::uuid, $2::uuid, $2::uuid::text, 'email', $3::jsonb, now(), now(), now())`,
          [
            randomUUID(),
            id,
            JSON.stringify({
              sub: id,
              email: input.email,
              email_verified: true,
              phone_verified: false,
            }),
          ],
        );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
    return { id, email: input.email, googleEmail };
  });
}
