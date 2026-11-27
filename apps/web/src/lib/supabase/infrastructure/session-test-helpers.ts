import type { SetAllCookies } from "@supabase/ssr";
import { NextRequest, type NextResponse } from "next/server";

type CookieWrite = Parameters<SetAllCookies>[0][number];

// @supabase/ssrが、cookieの書き換えのたびにsetAllの第2引数へ渡すヘッダー。
export const LIBRARY_CACHE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

export const SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

const COOKIE_ATTRIBUTES = {
  path: "/",
  sameSite: "lax",
  httpOnly: false,
} as const;

// @supabase/ssrがsetAllへ渡す、値を書くcookie。
export function writtenCookie(name: string, value: string): CookieWrite {
  return {
    name,
    value,
    options: { ...COOKIE_ATTRIBUTES, maxAge: SESSION_MAX_AGE_SECONDS },
  };
}

// @supabase/ssrがsetAllへ渡す、削除するcookie。
export function removedCookie(name: string): CookieWrite {
  return { name, value: "", options: { ...COOKIE_ATTRIBUTES, maxAge: 0 } };
}

// 応答がブラウザへ書くcookieを、名前で引ける形にする。
export function responseCookiesOf(response: NextResponse) {
  return Object.fromEntries(
    response.cookies.getAll().map((cookie) => [cookie.name, cookie]),
  );
}

// 応答のキャッシュの指定を、ライブラリが渡すヘッダーと同じ形にする。無いヘッダーはnull。
export function cacheHeadersOf(response: NextResponse) {
  return Object.fromEntries(
    Object.keys(LIBRARY_CACHE_HEADERS).map((name) => [
      name,
      response.headers.get(name),
    ]),
  );
}

export const NO_CACHE_HEADERS = {
  "Cache-Control": null,
  Expires: null,
  Pragma: null,
};

// 応答が後続の処理へ渡す要求のヘッダー。Next.jsのproxyは、上書きするヘッダーの名前の一覧と値を、応答のヘッダーで伝える。
export function forwardedHeadersOf(response: NextResponse): Headers {
  const names =
    response.headers.get("x-middleware-override-headers")?.split(",") ?? [];
  return new Headers(
    names.map((name): [string, string] => [
      name,
      response.headers.get(`x-middleware-request-${name}`) ?? "",
    ]),
  );
}

// Cookieヘッダーを、復号後の名前と値にする。
export function requestCookiesOf(headers: Headers): Record<string, string> {
  const request = new NextRequest("https://app.example.com/", { headers });
  return Object.fromEntries(
    request.cookies.getAll().map(({ name, value }) => [name, value]),
  );
}
