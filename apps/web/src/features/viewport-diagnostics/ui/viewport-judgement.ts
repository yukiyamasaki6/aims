const TOLERANCE_PX = 2;
const OFFSET_TOLERANCE_PX = 1;

export type ViewportJudgementInput = {
  // 可視の高さ(`visualViewport`の高さ×倍率。無いときは`innerHeight`)。
  visual: number;
  dvh: number;
  bodyHeight: number;
  // `visualViewport.offsetTop`。`visualViewport`が無いときはnull。
  offsetTop: number | null;
};

// 100dvhとbodyの高さが可視の高さから許容を超えてずれているか、可視領域が上下にずれているとき"BAD"、そうでなければ"ok"。
export function judgeViewport({
  visual,
  dvh,
  bodyHeight,
  offsetTop,
}: ViewportJudgementInput): "ok" | "BAD" {
  const heightBad =
    Math.abs(dvh - visual) > TOLERANCE_PX ||
    Math.abs(bodyHeight - visual) > TOLERANCE_PX;
  const shifted =
    offsetTop !== null && Math.abs(offsetTop) > OFFSET_TOLERANCE_PX;
  return heightBad || shifted ? "BAD" : "ok";
}
