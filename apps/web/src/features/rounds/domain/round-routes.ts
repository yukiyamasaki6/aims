// ラウンドの画面の経路。ラウンド一覧と詳細の経路の文字列は、この部品だけが持つ。
// 静的な設定(next.config.ts、serwist.config.mjs、app/manifest.ts、app/sw.ts、e2e)は、ここから導く。
// 例外: 要求の入口の対象の指定(proxy.tsのmatcher)は、Next.jsが静的に読み、定数を参照できないため文字列で再掲する。
// next.config.tsとserwist.config.mjsが直接読み込むため、importを持たず、型注釈以外の構文(enum等)は使わない。
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

// 経路に対応する枠の経路。枠のない経路はnull。
// 末尾スラッシュ付きや詳細の下の経路は一致させず、従来どおりネットワークに任せる。
export function roundFramePathOf(pathname: string): string | null {
  if (pathname === ROUNDS_PATH) return ROUNDS_PATH;
  if (pathname === NEW_ROUND_PATH) return NEW_ROUND_PATH;
  if (new RegExp(`^${ROUNDS_PATH}/[^/]+$`).test(pathname)) {
    return ROUND_FRAME_PATH;
  }
  return null;
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
