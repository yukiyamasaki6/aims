import type { BrowserContext, Cookie } from "@playwright/test";
import { combineChunks, createChunks, isChunkLike } from "@supabase/ssr";

// ブラウザに保存されたセッション(Cookie)の読み書き。
// `readStoredSessionCookie`と`readStoredTokens`は、分割されたCookie(`.0`、`.1`…)を扱わない。使い捨てのユーザーのセッションは分割の長さに収まる。
// 分割の有無に依らず扱うのは、`readChunkedTokens`と`expireStoredSession`である。

export const AUTH_COOKIE = "sb-localhost-auth-token";

type StoredSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string };
};

// 保存先のCookieと、その中のセッション。
export async function readStoredSessionCookie(
  context: BrowserContext,
): Promise<{ cookie: Cookie; session: StoredSession }> {
  const cookies = (await context.cookies()).filter(
    (c) => c.name === AUTH_COOKIE,
  );
  if (cookies.length !== 1) throw new Error("no single stored session");
  const [cookie] = cookies;
  return { cookie, session: decodeStoredSession(cookie.value) };
}

function decodeStoredSession(value: string): StoredSession {
  return JSON.parse(
    Buffer.from(value.replace(/^base64-/, ""), "base64url").toString("utf8"),
  );
}

// 保存先の全てのCookieと、分割を結合して復元したセッション。結合の規則はSDKに任せる。
async function readChunkedSession(context: BrowserContext) {
  const cookies = (await context.cookies()).filter((c) =>
    isChunkLike(c.name, AUTH_COOKIE),
  );
  const value = await combineChunks(
    AUTH_COOKIE,
    (name) => cookies.find((c) => c.name === name)?.value,
  );
  if (!value) throw new Error("no stored session");
  return { cookies, session: decodeStoredSession(value) };
}

// セッションを、保存先のCookieの値の形にする。
export function encodeStoredSession(session: StoredSession): string {
  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

// 保存されたセッションのアクセストークン、更新トークン、利用者ID。
export async function readStoredTokens(context: BrowserContext) {
  const { session } = await readStoredSessionCookie(context);
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    userId: session.user.id,
  };
}

// 分割されうるセッションの更新トークン、利用者ID、セッションID。
export async function readChunkedTokens(context: BrowserContext) {
  const { session } = await readChunkedSession(context);
  return {
    refreshToken: session.refresh_token,
    userId: session.user.id,
    sessionId: claimsOf(session.access_token).session_id as string,
  };
}

// 保存されたセッションを、SDKが次の読み取りで更新する状態(期限の記録が過去)にする。トークンは変えない。
export async function expireStoredSession(context: BrowserContext) {
  const { cookies, session } = await readChunkedSession(context);
  const expired = {
    ...session,
    expires_at: Math.floor(Date.now() / 1000) - 60,
  };
  const chunks = createChunks(AUTH_COOKIE, encodeStoredSession(expired));
  for (const { name } of cookies) await context.clearCookies({ name });
  await context.addCookies(
    chunks.map((chunk) => ({ ...cookies[0], ...chunk })),
  );
}

function claimsOf(accessToken: string) {
  return JSON.parse(
    Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"),
  );
}

// アクセストークンのクレームのうち、最初の認証方法(`amr[0].method`)。パスワードなら`password`、認証コードなら`otp`。
export function authMethodOf(accessToken: string): string | undefined {
  return claimsOf(accessToken).amr?.[0]?.method;
}
