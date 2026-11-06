// ラウンドの画面の経路を判定・変換する関数。経路の持ち主は経路表(src/routes.ts)である。
// 例外: 要求の入口の対象の指定(proxy.tsのmatcher)は、Next.jsが静的に読み、定数を参照できないため文字列で再掲する。
import { NEW_ROUND_PATH, ROUND_FRAME_PATH, ROUNDS_PATH } from "@/routes";

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
