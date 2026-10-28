// サインインの前後の経路の規則。保護対象の画面、未認証専用の画面、サインインのURL、サインインの後に戻ってよい場所(遷移元)。
// 経路の文字列は、この部品だけが持つ。
export const SIGN_IN_PATH = "/signin";
export const SIGN_UP_PATH = "/signup";
export const RESET_PASSWORD_PATH = "/reset-password";
const GUEST_ONLY_PATHS: readonly string[] = [
  SIGN_IN_PATH,
  SIGN_UP_PATH,
  RESET_PASSWORD_PATH,
];
const PROTECTED_PATH = "/rounds";
const DEFAULT_DESTINATION = PROTECTED_PATH;
const RETURN_TO_PARAM = "returnTo";
const MAX_LENGTH = 2048;
const BASE = "http://localhost";

// サインインが要る画面(ラウンド配下)かを返す。
function isProtectedPath(pathname: string): boolean {
  return (
    pathname === PROTECTED_PATH || pathname.startsWith(`${PROTECTED_PATH}/`)
  );
}

// 遷移元として受け付けるのは、保護対象の同一オリジンのパスに限る。
// 検証して正規化した pathname + search を返し、拒否は null。
export function allowedReturnTo(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length > MAX_LENGTH) return null;
  if (!raw.startsWith("/") || raw[1] === "/" || raw[1] === "\\") return null;
  // URLパーサが改行・タブを除去して//hostになる迂回を防ぐ。
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字の拒否が目的
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;

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
  return allowedReturnTo(returnTo) ?? DEFAULT_DESTINATION;
}

// 遷移元を付けたサインインのURL。無効な値や既定の行き先のみのときは付けない。
export function signInHref(from: string | null): string {
  const resolved = allowedReturnTo(from);
  if (resolved === null || resolved === destinationOf(null)) {
    return SIGN_IN_PATH;
  }
  return `${SIGN_IN_PATH}?${RETURN_TO_PARAM}=${encodeURIComponent(resolved)}`;
}

// クエリ文字列から、許可された遷移元を読む。無い、または拒否されたときはnull。
export function readReturnTo(search: string): string | null {
  return allowedReturnTo(new URLSearchParams(search).get(RETURN_TO_PARAM));
}

// 要求に対するリダイレクト先(パスとクエリ)。リダイレクトしないときはnull。
// 未認証でラウンド配下を開くと、遷移元付きのサインインへ送る。認証済みで未認証専用の画面を開くと、サインインなら有効な遷移元、それ以外はラウンド一覧へ送る。
// Server Action呼び出しは画面の遷移ではないため、リダイレクトしない(未認証の扱いは各Server Actionのガードに任せる)。
export function redirectFor(request: {
  signedIn: boolean;
  pathname: string;
  search: string;
  isServerAction: boolean;
}): string | null {
  if (request.isServerAction) return null;
  if (!request.signedIn && isProtectedPath(request.pathname)) {
    return signInHref(request.pathname + request.search);
  }
  if (request.signedIn && GUEST_ONLY_PATHS.includes(request.pathname)) {
    const destination =
      request.pathname === SIGN_IN_PATH ? readReturnTo(request.search) : null;
    return destination ?? DEFAULT_DESTINATION;
  }
  return null;
}
