import type { ReactNode } from "react";
import { TRIPLE_HEIGHT_RATIO } from "./target-triple";

// プリセットを表す、横長の角丸のカード(カード02・03・05で共通)。先頭の要素(的・距離の文字など。省略できる)、名前の線2本、上の辺の右寄りのしおり(省略できる)。
// 寸法は、幅widthから決まる(幅470のときの値に、widthの比を掛ける)。線の太さは、親の値のまま。
const PRESET_CARD_RATIO = 2.15;
export const presetCardHeight = (width: number) => width / PRESET_CARD_RATIO;
export const presetCardRadius = (width: number) => (40 * width) / 470;
// 的の外接の高さは、カードの縦の約73%。三つ目は的1つの半径がカードの縦の PRESET_TRIPLE_RADIUS 倍で、外接の高さはその TRIPLE_HEIGHT_RATIO 倍。他の的は、外接の高さ PRESET_TARGET_HEIGHT 倍に合わせる。
export const PRESET_TRIPLE_RADIUS = 0.19;
export const PRESET_TARGET_HEIGHT = PRESET_TRIPLE_RADIUS * TRIPLE_HEIGHT_RATIO;
type PresetCardProps = {
  // 左上の座標と幅
  x: number;
  y: number;
  width: number;
  // しおりを描くか
  bookmark: boolean;
  // 先頭の要素を描く。中心(x, y)と、カードの縦(height)を受け取る。省略すると描かない。
  target?: (at: { x: number; y: number; height: number }) => ReactNode;
};

// 名前の線。1本目の右端は、しおりの右端にそろい、2本目は1本目の0.6倍の長さ。
function nameLines(x: number, y: number, width: number) {
  const unit = width / 470;
  const left = x + width * 0.52;
  const right = x + width * 0.81 + 30 * unit;
  const first = y + presetCardHeight(width) * 0.54;
  const all = [
    { y: first, right },
    { y: first + 56 * unit, right: left + (right - left) * 0.6 },
  ];
  return all.map((l) => `M${left} ${l.y}H${l.right}`).join("");
}

export function PresetCard({ x, y, width, bookmark, target }: PresetCardProps) {
  const unit = width / 470;
  const height = presetCardHeight(width);
  const half = 30 * unit;
  const center = x + width * 0.81;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={presetCardRadius(width)}
        fill="var(--background)"
      />
      {bookmark ? (
        <path
          d={`M${center - half} ${y}H${center + half}V${y + 76 * unit}L${center} ${y + 62 * unit}L${center - half} ${y + 76 * unit}Z`}
          fill="currentColor"
        />
      ) : null}
      {target?.({ x: x + width * 0.27, y: y + height / 2, height })}
      <path d={nameLines(x, y, width)} />
    </g>
  );
}
