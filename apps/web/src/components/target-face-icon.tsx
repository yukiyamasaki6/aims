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

// 的画像本体の境界線は、得点帯を区切る情報として最低限見えれば十分で、
// 主役はあくまで色（得点帯）なので極力薄くする（拡大バッジの境界線はこれとは
// 別に太さを持つ）。
const STROKE_WIDTH_RATIO = 0.008;

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
  const strokeWidth = maxRadius * STROKE_WIDTH_RATIO;
  // strokeはパス（リング半径）を中心に太さの半分ずつ内外に描かれるため、
  // 最外リングの境界線がviewBoxの端で見切れないよう半分だけ余白を確保する。
  const viewExtent = maxRadius + strokeWidth / 2;

  return (
    <svg
      viewBox={`${-viewExtent} ${-viewExtent} ${viewExtent * 2} ${viewExtent * 2}`}
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
          strokeWidth={r.line_color ? strokeWidth : 0}
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
  // strokeはパス（リング半径）を中心に太さの半分ずつ内外に描かれるため、
  // 最外リングの境界線がviewBoxの端で見切れないよう半分だけ余白を確保する。
  const viewExtent = extent + (extent * STROKE_WIDTH_RATIO) / 2;

  return (
    <svg
      viewBox={`${-viewExtent} ${-viewExtent} ${viewExtent * 2} ${viewExtent * 2}`}
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
                strokeWidth={
                  r.line_color ? spotMaxRadius * STROKE_WIDTH_RATIO : 0
                }
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// 中心から見て的の色が変わるまで連続する内側のリング（例: 標準はX,10,9の黄）を
// 取り出す。得点表記を重ねる対象を「色」という見た目の単位で機械的に決めることで、
// 弓種等によって得点帯の構成が変わってもハードコードなしに追従できる。
function innerSameColorRings(rings: TargetFaceRing[]): TargetFaceRing[] {
  const sorted = [...rings].sort((a, b) => a.radius - b.radius);
  if (sorted.length === 0) return [];
  const innerColor = sorted[0].color;
  const result: TargetFaceRing[] = [];
  for (const r of sorted) {
    if (r.color !== innerColor) break;
    result.push(r);
  }
  return result;
}

// 的中心部（同色の内側リング）の右上90度分だけを切り出し、得点帯ごとに得点表記を
// 重ねたバッジ。色・半径だけでは見分けがつかない的（例: 弓種によってXリングの
// 有無・得点帯の境界が異なる場合）を、実際の得点表記で見分けられるようにする。
//
// 枠（ビューポート）は「最外リングの外径が右上の角（中心から最も遠い対角の点）に
// ちょうど接する」大きさにする。中心から枠の角までの距離は枠の一辺の√2倍なので、
// 一辺は最外リングの半径÷√2。クラスタの要素数に関わらず、常に「配色が同じ内側
// リング全部」を対象にするだけなので、フィールド的等の得点帯構成にも自動的に
// 追従する。
function TargetFaceCenterBadge({
  rings,
  pixelSize,
}: {
  rings: TargetFaceRing[];
  pixelSize: number;
}) {
  const cluster = innerSameColorRings(rings);
  if (cluster.length === 0) return null;

  const outerRadius = cluster[cluster.length - 1].radius;
  const boxSide = outerRadius / Math.SQRT2;
  // フォントサイズはpixelSizeではなくviewBoxと同じcm単位のスケールで指定する
  // 必要がある（そうしないと極端に巨大な文字になる）。
  const fontSize = boxSide / 4.5;

  return (
    <span
      className="pointer-events-none absolute top-0 right-0 overflow-hidden border border-black bg-white"
      style={{ width: pixelSize, height: pixelSize }}
    >
      <svg
        viewBox={`0 ${-boxSide} ${boxSide} ${boxSide}`}
        width={pixelSize}
        height={pixelSize}
        role="img"
        aria-label={cluster.map((r) => r.score_str).join(", ")}
      >
        {[...cluster].reverse().map((r) => (
          <circle
            key={r.z_index}
            cx={0}
            cy={0}
            r={r.radius}
            fill={r.color}
            stroke={r.line_color ?? "none"}
            strokeWidth={r.line_color ? boxSide * 0.04 : 0}
          />
        ))}
        {cluster.map((r, i) => {
          const innerEdge = i === 0 ? 0 : cluster[i - 1].radius;
          const mid = (innerEdge + r.radius) / 2;
          const offset = mid / Math.SQRT2;
          return (
            <text
              key={r.z_index}
              x={offset}
              y={-offset}
              fontSize={fontSize}
              fontWeight="bold"
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#231F20"
            >
              {r.score_str}
            </text>
          );
        })}
      </svg>
    </span>
  );
}

// 的の見た目（TargetFaceThumbnail）とサイズの数字を1枚のタイルにまとめたもの。
// 的選択のポップアップ・その選択中1枚のプレビュー・距離の要約行など、
// 「文字のラベルなしで、見た目とサイズだけで的を示す」場面で共通して使う。
// サイズの文字はタイルサイズ（pixelSize）のおよそ1/3になるよう比例させる。
// 右上には中心部（同色の内側リング）をズームして得点表記を重ねたバッジを重ね、
// 色・半径が同じでも得点帯の構成が異なる的（弓種差分等）を見分けられるようにする。
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
  const representativeRings = spots[0]?.target_face_rings ?? [];

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden",
        className,
      )}
      style={{ width: pixelSize, height: pixelSize }}
    >
      <TargetFaceThumbnail spots={spots} className="size-full" />
      <span
        className="pointer-events-none absolute bottom-0 left-0 font-heading text-black leading-none"
        style={{
          fontSize: pixelSize / 3,
          WebkitTextStroke: `${Math.max(1, pixelSize / 40)}px white`,
          paintOrder: "stroke fill",
        }}
      >
        {sizeCm}
      </span>
      <TargetFaceCenterBadge
        rings={representativeRings}
        pixelSize={pixelSize * 0.5}
      />
    </span>
  );
}
