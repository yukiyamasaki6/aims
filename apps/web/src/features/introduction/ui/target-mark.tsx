// 図の中の的の絵(簡略化した描き方)。輪の色と、色ごとの外縁の半径の比は、アプリの的の定義(target_face_rings。supabase/migrations/20261016000100_target_faces.sql)と同じで、画面の配色(テーマ)に依存しない。
import { BLUE, GOLD, BLACK as OUTLINE, RED, TARGET_LINE } from "./target-style";

// 外側の輪から順に、色と半径(的の半径を50としたとき)。
export const RINGS = {
  // 6点的(アウトドア・80cm): 色ごとの外縁が 黄1/3・赤2/3・青1
  six: [
    [BLUE, 50],
    [RED, (50 * 2) / 3],
    [GOLD, 50 / 3],
  ],
  // 3つ目の6点的(インドア・60cm): 色ごとの外縁が 黄0.4・赤0.8・青1
  spot3: [
    [BLUE, 50],
    [RED, 40],
    [GOLD, 20],
  ],
} as const;

type TargetMarkProps = {
  variant: keyof typeof RINGS;
  x: number;
  y: number;
  radius: number;
};

// 中心(x, y)、半径radiusの的を、親のSVGの中に描く。
export function TargetMark({ variant, x, y, radius }: TargetMarkProps) {
  const scale = radius / 50;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      {RINGS[variant].map(([color, r]) => (
        <circle
          key={r}
          r={r}
          fill={color}
          stroke={OUTLINE}
          strokeWidth={TARGET_LINE / scale}
        />
      ))}
    </g>
  );
}
