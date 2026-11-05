// サインインの前後の経路の規則。保護対象の画面、未認証専用の画面、サインインのURL、サインインの後に戻ってよい場所(遷移元)。
// 認証の画面の経路の文字列は、この部品だけが持つ。保護対象の画面の範囲は、その根の経路(protectedPath)を使う側から受け取る。根は、サインインの後の既定の行き先でもある。
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
function isProtectedPath(pathname: string, protectedPath: string): boolean {
  return pathname === protectedPath || pathname.startsWith(`${protectedPath}/`);
}

// 遷移元として受け付けるのは、保護対象の同一オリジンのパスに限る。
// 検証して正規化した pathname + search を返し、拒否は null。
export function allowedReturnTo(
  raw: string | null | undefined,
  protectedPath: string,
): string | null {
  if (typeof raw !== "string") return null;

  // URLパーサが//hostや/\hostの形にする迂回は、基準と別のオリジンになるため、次の検査で拒否される。
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  if (!isProtectedPath(url.pathname, protectedPath)) return null;
  return url.pathname + url.search;
}

export function destinationOf(
  returnTo: string | null,
  protectedPath: string,
): string {
  return allowedReturnTo(returnTo, protectedPath) ?? protectedPath;
}

// 遷移元を付けたサインインのURL。無効な値のときは付けない。
export function signInHref(from: string | null, protectedPath: string): string {
  const resolved = allowedReturnTo(from, protectedPath);
  if (resolved === null) return SIGN_IN_PATH;
  return `${SIGN_IN_PATH}?${RETURN_TO_PARAM}=${encodeURIComponent(resolved)}`;
}

// 要求に対するリダイレクト先(パスとクエリ)。リダイレクトしないときはnull。
// 未認証で保護の範囲を開くと、遷移元付きのサインインへ送る。認証済みで未認証専用の画面を開くと、既定の行き先へ送る。
// Server Action呼び出しは画面の遷移ではないため、リダイレクトしない(未認証の扱いは各Server Actionのガードに任せる)。
export function redirectFor(
  request: {
    signedIn: boolean;
    pathname: string;
    search: string;
    isServerAction: boolean;
  },
  protectedPath: string,
): string | null {
  if (request.isServerAction) return null;
  if (!request.signedIn && isProtectedPath(request.pathname, protectedPath)) {
    return signInHref(request.pathname + request.search, protectedPath);
  }
  if (request.signedIn && GUEST_ONLY_PATHS.includes(request.pathname)) {
    return destinationOf(null, protectedPath);
  }
  return null;
}
