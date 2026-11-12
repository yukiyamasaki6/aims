// アプリ全体の経路表。経路の事実(定数と、経路を作る関数)だけを持つ。
// 経路を判定・変換する関数は、各機能の`domain/<概念>-routes.ts`が持つ。
// next.config.tsとserwist.config.mjsが直接読み込むため、importを持たず、型注釈以外の構文(enum等)は使わない。
// `export const …`と、型注釈つきの`export function …`だけで書く(Nodeの型除去で読める形)。
// 何も参照しないため、全ての層と設定とテストが参照してよい。

// オフライン時に返す、認証に依存しない静的なページ。
export const OFFLINE_PATH = "/offline";

// プリキャッシュの枠のURL。proxy.tsのmatcher外の/__shell/*で配り、未認証での登録でも/signinのHTMLを保存しない。
const SHELL_PREFIX = "/__shell";

// 枠の経路に対応する、配布用のURL。
export function shellUrlOf(framePath: string): string {
  return `${SHELL_PREFIX}${framePath}`;
}

// 枠の経路に対応する、ビルド成果物(.next/server/app配下)のHTMLの名前。
export function frameHtmlOf(framePath: string): string {
  return `${framePath.slice(1)}.html`;
}

// ラウンドのホーム、履歴、作成、詳細の画面の経路。
// ROUNDS_PATHはラウンドの画面全体の根(保護の範囲)、ROUNDS_HOME_PATHはホーム画面で、値は同じである。
// 同値の別名の再エクスポートはknipが重複として報告するため、ROUNDS_HOME_PATHは根から作る。
export const ROUNDS_PATH = "/rounds";
export const ROUNDS_HOME_PATH = `${ROUNDS_PATH}`;
export const ROUNDS_HISTORY_PATH = `${ROUNDS_PATH}/history`;
export const NEW_ROUND_PATH = `${ROUNDS_PATH}/new`;

// 詳細の遷移元。URLのクエリに載せ、履歴から開いたときだけ付ける(無ければホーム)。
export const ROUND_ORIGIN_PARAM = "from";
export const ROUND_ORIGIN_HISTORY = "history";

// 詳細の経路。履歴から開くとき(from = "history")だけ、遷移元のクエリを付ける。
export function roundPath(roundId: string, from?: string): string {
  const path = `${ROUNDS_PATH}/${roundId}`;
  return from === ROUND_ORIGIN_HISTORY
    ? `${path}?${ROUND_ORIGIN_PARAM}=${ROUND_ORIGIN_HISTORY}`
    : path;
}

// 詳細の画面は、全てのラウンドで同じ静的な枠(プレースホルダーのIDで描く)で配る。
export const ROUND_FRAME_ID = "_";
export const ROUND_FRAME_PATH = `${ROUNDS_PATH}/${ROUND_FRAME_ID}`;

// 設定の画面の経路。分類ごとの経路は持たない。
export const SETTINGS_PATH = "/settings";

// 全ての画面の枠の経路。ラウンドのホーム、履歴、作成、詳細と、設定の5つ。
export const FRAME_PATHS: string[] = [
  ROUNDS_HOME_PATH,
  ROUNDS_HISTORY_PATH,
  NEW_ROUND_PATH,
  ROUND_FRAME_PATH,
  SETTINGS_PATH,
];

// 認証の画面の経路。
export const SIGN_IN_PATH = "/signin";
export const SIGN_UP_PATH = "/signup";
export const RESET_PASSWORD_PATH = "/reset-password";

// アプリの紹介画面。ロゴの行き先。
export const HOME_PATH = "/";

// Service Workerのスクリプトの配信先。
export const SW_PATH = "/sw.js";
