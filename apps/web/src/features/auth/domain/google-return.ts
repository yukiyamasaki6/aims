import { LINK_GOOGLE_PARAM, LINK_GOOGLE_VALUE } from "@/routes";

// Googleでの認証の戻りの規則。認証サービスは、戻り先のクエリに、成功なら`code`、失敗なら`error`(と`error_code`、`error_description`)を付ける。
// 取り消し・拒否は`error=access_denied`で`error_code`が無い。別のアカウントに結び付いたGoogleの追加は`error_code=identity_already_exists`。それ以外の失敗は、その他とする。

export type GoogleReturn =
  | { readonly kind: "code"; readonly code: string }
  | { readonly kind: "cancelled" }
  | { readonly kind: "taken" }
  | { readonly kind: "failed" };

// 戻りのクエリのパラメーター名。戻りの後始末で外す。
const RETURN_PARAMS: readonly string[] = [
  "code",
  "error",
  "error_code",
  "error_description",
  LINK_GOOGLE_PARAM,
];

// クエリ(`location.search`の形。無いときは空文字)から戻りを読む。戻りでなければnull。
export function googleReturnOf(search: string): GoogleReturn | null {
  const params = new URLSearchParams(search);
  if (params.has("error")) {
    const errorCode = params.get("error_code");
    if (errorCode === "identity_already_exists") return { kind: "taken" };
    return params.get("error") === "access_denied" && errorCode === null
      ? { kind: "cancelled" }
      : { kind: "failed" };
  }
  const code = params.get("code");
  return code ? { kind: "code", code } : null;
}

// Googleアカウントの追加の戻り(追加の印があり、戻りの形をしている)。そうでなければnull。
export function linkGoogleReturnOf(search: string): GoogleReturn | null {
  const params = new URLSearchParams(search);
  return params.get(LINK_GOOGLE_PARAM) === LINK_GOOGLE_VALUE
    ? googleReturnOf(search)
    : null;
}

// 戻りのクエリ(と追加の印)を外したクエリ(先頭の`?`つき。残りが無いときは空文字)。他のクエリ(`returnTo`など)は残す。ハッシュは、書き換える側が持たない。
export function withoutGoogleReturn(search: string): string {
  const params = new URLSearchParams(search);
  for (const name of RETURN_PARAMS) params.delete(name);
  const rest = params.toString();
  return rest === "" ? "" : `?${rest}`;
}
