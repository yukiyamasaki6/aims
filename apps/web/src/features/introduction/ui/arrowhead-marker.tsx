import { FIGURE_LINE } from "./figure-svg";

// 矢印の矢じり(腕の長さ40、半角42度。図の座標)のmarker。軸の終端の接線方向に自動で向く。
// 図を拡大率kで拡大して描くとき(設計の座標が図の座標の 1/k のとき)は、kを渡して、矢じりの大きさと線の太さを逆数で補正する。
const ARM = 40;
const HALF_ANGLE = 0.733;

export function ArrowheadMarker({ id, k = 1 }: { id: string; k?: number }) {
  const arm = ARM / k;
  const back = -arm * Math.cos(HALF_ANGLE);
  const side = arm * Math.sin(HALF_ANGLE);
  return (
    <marker
      id={id}
      markerUnits="userSpaceOnUse"
      orient="auto"
      viewBox="-100 -100 200 200"
      markerWidth="200"
      markerHeight="200"
      refX="0"
      refY="0"
    >
      <path
        d={`M${back} ${-side}L0 0L${back} ${side}`}
        strokeWidth={FIGURE_LINE / k}
      />
    </marker>
  );
}
