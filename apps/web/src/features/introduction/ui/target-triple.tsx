import { TargetMark } from "./target-mark";

// 6点的(インドア・60cm・3つ目トライアングル)の3つの的の配置。アプリの的の定義(target_face_spots・target_face_rings)と同じ値(cm)。
// 中心は、図の向き(下向きがプラス)に直してある(アプリは上向きがプラス)。半径は、各的の最大のリングの半径。
export const TRIPLE_SPOTS = [
  { x: 0, y: -18.48 },
  { x: -16, y: 9.24 },
  { x: 16, y: 9.24 },
] as const;
export const TRIPLE_RADIUS = 15;
// 3つの的の外接の範囲の、上端・下端と、縦の中央(中心のy座標)
const TOP_Y = TRIPLE_SPOTS[0].y - TRIPLE_RADIUS;
const BOTTOM_Y = TRIPLE_SPOTS[1].y + TRIPLE_RADIUS;
const MIDDLE_Y = (TOP_Y + BOTTOM_Y) / 2;
// 外接の高さは、的1つの半径のこの倍(アプリの配置)
export const TRIPLE_HEIGHT_RATIO = (BOTTOM_Y - TOP_Y) / TRIPLE_RADIUS;

type TargetTripleProps = {
  x: number;
  y: number;
  radius: number;
};

// 3つの的を、アプリと同じ配置・同じ大きさの関係で描く。radiusは、3つの的それぞれの半径。(x, y)は、3つの的の外接の範囲の中心。
export function TargetTriple({ x, y, radius }: TargetTripleProps) {
  const scale = radius / TRIPLE_RADIUS;
  return (
    <>
      {TRIPLE_SPOTS.map((spot) => (
        <TargetMark
          key={`${spot.x}`}
          variant="spot3"
          x={x + spot.x * scale}
          y={y + (spot.y - MIDDLE_Y) * scale}
          radius={radius}
        />
      ))}
    </>
  );
}
