export type TargetFaceRing = {
  radius: number;
  color: string;
  line_color: string | null;
  z_index: number;
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
