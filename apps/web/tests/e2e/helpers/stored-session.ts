import type { BrowserContext, Cookie } from "@playwright/test";

// ブラウザに保存されたセッション(Cookie)の読み書き。
// 分割されたCookie(`.0`、`.1`…)は扱わない。使い捨てのユーザーのセッションは分割の長さに収まる。

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
  const session: StoredSession = JSON.parse(
    Buffer.from(cookie.value.replace(/^base64-/, ""), "base64url").toString(
      "utf8",
    ),
  );
  return { cookie, session };
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

// アクセストークンのクレームのうち、最初の認証方法(`amr[0].method`)。パスワードなら`password`、認証コードなら`otp`。
export function authMethodOf(accessToken: string): string | undefined {
  const payload = JSON.parse(
    Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"),
  );
  return payload.amr?.[0]?.method;
}
