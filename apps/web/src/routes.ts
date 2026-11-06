// アプリ全体の経路表。経路の事実(定数と、経路を作る関数)だけを持つ。
// 経路を判定・変換する関数は、各機能の`domain/<概念>-routes.ts`が持つ。
// next.config.tsとserwist.config.mjsが直接読み込むため、importを持たず、型注釈以外の構文(enum等)は使わない。
// `export const …`と、型注釈つきの`export function …`だけで書く(Nodeの型除去で読める形)。
// 何も参照しないため、全ての層と設定とテストが参照してよい。

// オフライン時に返す、認証に依存しない静的なページ。
export const OFFLINE_PATH = "/offline";

// プリキャッシュの枠のURL。proxy.tsのmatcher外の/__shell/*で配り、未認証での登録でも/signinのHTMLを保存しない。
export const SHELL_PREFIX = "/__shell";

// 枠の経路に対応する、配布用のURL。
export function shellUrlOf(framePath: string): string {
  return `${SHELL_PREFIX}${framePath}`;
}

// 枠の経路に対応する、ビルド成果物(.next/server/app配下)のHTMLの名前。
export function frameHtmlOf(framePath: string): string {
  return `${framePath.slice(1)}.html`;
}

// ラウンドの一覧、作成、詳細の画面の経路。
export const ROUNDS_PATH = "/rounds";
export const NEW_ROUND_PATH = `${ROUNDS_PATH}/new`;
export function roundPath(roundId: string): string {
  return `${ROUNDS_PATH}/${roundId}`;
}

// 詳細の画面は、全てのラウンドで同じ静的な枠(プレースホルダーのIDで描く)で配る。
export const ROUND_FRAME_ID = "_";
export const ROUND_FRAME_PATH = `${ROUNDS_PATH}/${ROUND_FRAME_ID}`;
// 枠の経路。一覧、作成、詳細の3つ。
export const ROUND_FRAME_PATHS: string[] = [
  ROUNDS_PATH,
  NEW_ROUND_PATH,
  ROUND_FRAME_PATH,
];

// 認証の画面の経路。
export const SIGN_IN_PATH = "/signin";
export const SIGN_UP_PATH = "/signup";
export const RESET_PASSWORD_PATH = "/reset-password";

// アプリの紹介画面。ロゴの行き先。
export const HOME_PATH = "/";
