import { cn } from "@/lib/utils";

export type TargetFaceRing = {
  radius: number;
  color: string;
  line_color: string | null;
  z_index: number;
  score_str: string;
  score_int: number;
};

export type TargetFaceSpotLayout = {
  center_x: number;
  center_y: number;
  target_face_rings: TargetFaceRing[];
};

// 的をリングデータ（半径・色・境界線色）から同心円として描画する。
// target_facesの名称文字列には依存しない。cm単位の半径をそのままviewBoxに
// 渡すことで、拡縮・将来のクリック座標の逆変換（着弾記録UI等）にも同じ
// 幾何データを再利用できる。
export function TargetFaceIcon({
  rings,
  size = 24,
}: {
  rings: TargetFaceRing[];
  size?: number;
}) {
  if (rings.length === 0) {
    return (
      <span
        className="inline-block shrink-0 rounded-full border border-dashed"
        style={{ width: size, height: size }}
      />
    );
  }

  const maxRadius = Math.max(...rings.map((r) => r.radius));
  const sorted = [...rings].sort((a, b) => b.radius - a.radius);

  return (
    <svg
      viewBox={`${-maxRadius} ${-maxRadius} ${maxRadius * 2} ${maxRadius * 2}`}
      width={size}
      height={size}
      className="shrink-0"
      aria-hidden="true"
    >
      {sorted.map((r) => (
        <circle
          key={r.z_index}
          cx={0}
          cy={0}
          r={r.radius}
          fill={r.color}
          stroke={r.line_color ?? "none"}
          strokeWidth={r.line_color ? maxRadius * 0.02 : 0}
        />
      ))}
    </svg>
  );
}

// TargetFaceIconと異なり、3つ目（トライアングル/バーティカル）等の複数スポットを
// center_x/center_yの相対位置で正しく配置して描画する。的選択UIのように、
// 実際のレイアウト（1つ目/3つ目トライアングル/3つ目バーティカル）の違いを
// 一目で見分けたい場面で使う。center_yはデータ上「上が正」のため、SVGのy軸
// （下が正）に合わせて符号を反転させる。
export function TargetFaceThumbnail({
  spots,
  size = 64,
  className,
}: {
  spots: TargetFaceSpotLayout[];
  size?: number;
  className?: string;
}) {
  const hasAnyRing = spots.some((s) => s.target_face_rings.length > 0);
  if (!hasAnyRing) {
    return (
      <span
        className={cn(
          "inline-block shrink-0 rounded-full border border-dashed",
          className,
        )}
        style={{ width: size, height: size }}
      />
    );
  }

  let extent = 0;
  for (const spot of spots) {
    const spotMaxRadius =
      spot.target_face_rings.length > 0
        ? Math.max(...spot.target_face_rings.map((r) => r.radius))
        : 0;
    extent = Math.max(
      extent,
      Math.abs(spot.center_x) + spotMaxRadius,
      Math.abs(spot.center_y) + spotMaxRadius,
    );
  }

  return (
    <svg
      viewBox={`${-extent} ${-extent} ${extent * 2} ${extent * 2}`}
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      {spots.map((spot) => {
        const sorted = [...spot.target_face_rings].sort(
          (a, b) => b.radius - a.radius,
        );
        const spotMaxRadius = sorted.length > 0 ? sorted[0].radius : 0;
        return (
          <g
            key={`${spot.center_x}-${spot.center_y}`}
            transform={`translate(${spot.center_x} ${-spot.center_y})`}
          >
            {sorted.map((r) => (
              <circle
                key={r.z_index}
                cx={0}
                cy={0}
                r={r.radius}
                fill={r.color}
                stroke={r.line_color ?? "none"}
                strokeWidth={r.line_color ? spotMaxRadius * 0.02 : 0}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// 的の見た目（TargetFaceThumbnail）とサイズの数字を1枚のタイルにまとめたもの。
// 的選択のポップアップ・その選択中1枚のプレビュー・距離の要約行など、
// 「文字のラベルなしで、見た目とサイズだけで的を示す」場面で共通して使う。
// サイズの文字はタイルサイズ（pixelSize）のおよそ1/3になるよう比例させる。
export function TargetFaceTile({
  spots,
  sizeCm,
  pixelSize = 64,
  className,
}: {
  spots: TargetFaceSpotLayout[];
  sizeCm: number;
  pixelSize?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        className,
      )}
      style={{ width: pixelSize, height: pixelSize }}
    >
      <TargetFaceThumbnail spots={spots} className="size-full p-1" />
      <span
        className="pointer-events-none absolute top-0 right-0.5 font-heading text-black leading-none"
        style={{
          fontSize: pixelSize / 3,
          WebkitTextStroke: `${Math.max(1, pixelSize / 40)}px white`,
          paintOrder: "stroke fill",
        }}
      >
        {sizeCm}
      </span>
    </span>
  );
}
