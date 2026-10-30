// ラウンドの画面の経路。ラウンド一覧の経路の文字列は、この部品だけが持つ。
// 例外: 要求の入口の対象の指定(proxy.tsのmatcher)は静的な設定のため文字列で再掲する。未適用の作成、詳細、オフラインの画面は、まだ文字列を持つ。
export const ROUNDS_PATH = "/rounds";
export const NEW_ROUND_PATH = `${ROUNDS_PATH}/new`;
export function roundPath(roundId: string): string {
  return `${ROUNDS_PATH}/${roundId}`;
}
