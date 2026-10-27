// 遷移元。サインインの後に戻ってよい場所の規則と、URLで運ぶときのクエリの名前と、サインインのURLの形。
const RETURN_TO_PARAM = "returnTo";
const SIGN_IN_PATH = "/signin";
const DEFAULT_DESTINATION = "/rounds";
const MAX_LENGTH = 2048;
const BASE = "http://localhost";

// 遷移元として受け付けるのは、保護対象の/rounds配下の同一オリジンのパスに限る。
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
  if (url.pathname !== "/rounds" && !url.pathname.startsWith("/rounds/")) {
    return null;
  }
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
