// サインインの前後の経路の規則。保護対象の画面、未認証専用の画面、サインインのURL、サインインの後に戻ってよい場所(遷移元)。
// 認証の画面の経路の文字列は、この部品だけが持つ。保護対象の画面の範囲は、ラウンド一覧の経路(ROUNDS_PATH)とその配下である。根は、サインインの後の既定の行き先でもある。
// 例外: この部品は、ドメイン層から他の機能(rounds)の入口を値で読む(architecture.mdの例外。他の層・他の場所は読まない)。
import { ROUNDS_PATH } from "@/features/rounds";

export const SIGN_IN_PATH = "/signin";
export const SIGN_UP_PATH = "/signup";
export const RESET_PASSWORD_PATH = "/reset-password";
const GUEST_ONLY_PATHS: readonly string[] = [
  SIGN_IN_PATH,
  SIGN_UP_PATH,
  RESET_PASSWORD_PATH,
];
export const RETURN_TO_PARAM = "returnTo";
const BASE = "http://localhost";

// サインインが要る画面(保護の範囲の根とその配下)かを返す。
function isProtectedPath(pathname: string): boolean {
  return pathname === ROUNDS_PATH || pathname.startsWith(`${ROUNDS_PATH}/`);
}

// 遷移元として受け付けるのは、保護対象の同一オリジンのパスに限る。
// 検証して正規化した pathname + search を返し、拒否は null。
export function allowedReturnTo(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;

  // URLパーサが//hostや/\hostの形にする迂回は、基準と別のオリジンになるため、次の検査で拒否される。
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  if (!isProtectedPath(url.pathname)) return null;
  return url.pathname + url.search;
}

export function destinationOf(returnTo: string | null): string {
  return allowedReturnTo(returnTo) ?? ROUNDS_PATH;
}

// 遷移元を付けたサインインのURL。遷移元がnullのときは付けない。
// 入力は、ブラウザの今の場所と、保護の範囲を開いた要求のパスで、どちらも保護の範囲の中である。外部の値は、読む側(destinationOf)が検証する。
export function signInHref(from: string | null): string {
  if (from === null) return SIGN_IN_PATH;
  return `${SIGN_IN_PATH}?${RETURN_TO_PARAM}=${encodeURIComponent(from)}`;
}

// 要求に対するリダイレクト先(パスとクエリ)。リダイレクトしないときはnull。
// 未認証で保護の範囲を開くと、遷移元付きのサインインへ送る。認証済みで未認証専用の画面を開くと、サインインなら有効な遷移元、それ以外は既定の行き先へ送る。
export function redirectFor(request: {
  signedIn: boolean;
  pathname: string;
  search: string;
}): string | null {
  if (!request.signedIn && isProtectedPath(request.pathname)) {
    return signInHref(request.pathname + request.search);
  }
  if (request.signedIn && request.pathname === SIGN_IN_PATH) {
    return destinationOf(
      new URLSearchParams(request.search).get(RETURN_TO_PARAM),
    );
  }
  if (request.signedIn && GUEST_ONLY_PATHS.includes(request.pathname)) {
    return ROUNDS_PATH;
  }
  return null;
}
