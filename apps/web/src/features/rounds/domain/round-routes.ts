// ラウンドの画面の経路。ラウンド一覧と詳細の経路の文字列は、この部品だけが持つ。
// 例外: 静的な設定は文字列で再掲する。要求の入口の対象の指定(proxy.tsのmatcher)、リライトの設定(next.config.tsの`/rounds/:id`を枠`/rounds/_`へ向けるもの)、オフラインとアプリとしての利用(app/sw-frames.ts、app/manifest.ts)である。
export const ROUNDS_PATH = "/rounds";
export const NEW_ROUND_PATH = `${ROUNDS_PATH}/new`;
export function roundPath(roundId: string): string {
  return `${ROUNDS_PATH}/${roundId}`;
}

const ROUND_PATH = new RegExp(
  `^${ROUNDS_PATH}/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/?$`,
  "i",
);

// 経路からラウンドのIDを読む。UUIDでなければnull。
// 非UUIDをそのまま問い合わせると22P02(400)になり「見つかりません」と区別できないため、UUID形式かをここで検証する。
export function roundIdOfPath(pathname: string): string | null {
  return ROUND_PATH.exec(pathname)?.[1] ?? null;
}
