const RETURN_TO_PARAM = "returnTo";
const DEFAULT_DESTINATION = "/rounds";
const MAX_LENGTH = 2048;
const BASE = "http://localhost";

// 遷移元として受け付けるのは、保護対象の/rounds配下の同一オリジンのパスに限る。
// 検証して正規化した pathname + search を返し、拒否は null。
export function resolveReturnTo(raw: string | null | undefined): string | null {
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

export function readReturnTo(search: string): string | null {
  return resolveReturnTo(new URLSearchParams(search).get(RETURN_TO_PARAM));
}

// 遷移元を付けた/signinのURL。無効な値や既定の行き先(/rounds)のみのときは付けない。
export function signInHref(from: string | null): string {
  const resolved = resolveReturnTo(from);
  if (resolved === null || resolved === DEFAULT_DESTINATION) return "/signin";
  return `/signin?${RETURN_TO_PARAM}=${encodeURIComponent(resolved)}`;
}
