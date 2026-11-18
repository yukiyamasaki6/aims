import { FIGURE_LINE } from "./figure-svg";
import { BLACK, BLUE, GOLD, RED, TARGET_LINE, WHITE } from "./target-style";

// 内側から外側へ。5色の同心円で、各リングの幅は等しい。
const STANDARD_COLORS = [GOLD, RED, BLUE, BLACK, WHITE] as const;
// 的の大きさの基準にする線の太さ(viewBox座標)。色の塗りの外縁は、外周の線の外縁から、この太さの半分だけ内側にある。
const FRAME_WIDTH = FIGURE_LINE;

type StandardTargetProps = {
  x: number;
  y: number;
  // 外周の線の外縁までの半径(的の大きさ)
  outer: number;
  // 親の拡大率の逆数。外周の線の太さ(TARGET_LINE)と、塗りの外縁の基準(FRAME_WIDTH)を、拡大しても図の座標で同じにするために掛ける。
  k?: number;
};

// この図の的。内側から 黄・赤・青・黒・白 の5色の同心円(各リングの幅は等しい)で、色の境に線は引かない。一番外側の白の外周にだけ、最小限の太さの線を引く。
export function StandardTarget({ x, y, outer, k = 1 }: StandardTargetProps) {
  const edge = outer - (FRAME_WIDTH * k) / 2;
  const width = edge / STANDARD_COLORS.length;
  return (
    <g transform={`translate(${x} ${y})`}>
      {[...STANDARD_COLORS].reverse().map((color, i) => (
        <circle key={color} r={edge - width * i} fill={color} stroke="none" />
      ))}
      <circle r={edge} fill="none" strokeWidth={TARGET_LINE * k} />
    </g>
  );
}
