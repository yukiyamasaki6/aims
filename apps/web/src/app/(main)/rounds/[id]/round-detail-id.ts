const ROUND_PATH =
  /^\/rounds\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

// 非UUIDをそのまま問い合わせると22P02(400)になり「見つかりません」と区別できないため、UUID形式かをここで検証する。
export function parseRoundId(pathname: string): string | null {
  return ROUND_PATH.exec(pathname)?.[1] ?? null;
}
