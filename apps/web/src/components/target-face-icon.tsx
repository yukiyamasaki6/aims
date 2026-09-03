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

// 規定（標的中心に太さ1mm・長さ4mm以下の「＋」を付け、中心位置を示す）に
// 基づく固定値。radius等と同じcm単位で、的のサイズに関わらず一定の実寸。
const CENTER_CROSS_ARM_LENGTH_CM = 0.2;
const CENTER_CROSS_STROKE_WIDTH_CM = 0.1;

// 的をリングデータ（半径・色・境界線色）から同心円として描画する。
// target_facesの名称文字列には依存しない。cm単位の半径をそのままviewBoxに
// 渡すことで、拡縮・将来のクリック座標の逆変換（着弾記録UI等）にも同じ
// 幾何データを再利用できる。1つ目の的はspotsに1要素だけ渡せばよく、
// 3つ目（トライアングル/バーティカル）等の複数スポットもcenter_x/center_yの
// 相対位置で正しく配置して描画する。的選択UIのように、実際のレイアウトの違いを
// 一目で見分けたい場面で使う。center_yはデータ上「上が正」のため、SVGのy軸
// （下が正）に合わせて符号を反転させる。
export function TargetFaceIcon({
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
            <line
              x1={-CENTER_CROSS_ARM_LENGTH_CM}
              y1={0}
              x2={CENTER_CROSS_ARM_LENGTH_CM}
              y2={0}
              stroke="#231F20"
              strokeWidth={CENTER_CROSS_STROKE_WIDTH_CM}
            />
            <line
              x1={0}
              y1={-CENTER_CROSS_ARM_LENGTH_CM}
              x2={0}
              y2={CENTER_CROSS_ARM_LENGTH_CM}
              stroke="#231F20"
              strokeWidth={CENTER_CROSS_STROKE_WIDTH_CM}
            />
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

// 全体の円の半径に対する、切り出す横長の帯の高さ（中心から片側）の比率。
const CENTER_DETAIL_BAND_RATIO = 0.3;
// 得点表記は中心から右方向にしか置かれないため、左側は中心点が見える最小限
// （半径に対するこの比率）だけ残し、大部分を右側（表記がある側）に使う。
const CENTER_DETAIL_LEFT_MARGIN_RATIO = 0.15;

// 的中心部（同色の内側リング）を、扇形に切り出すのではなく円のまま横長の帯で
// クロップした拡大図。円自体は変形せず、単純に上下を狭く切り取るだけなので、
// 「写真の横長トリミング」と同じ自然な見え方になり、扇形特有の「なぜこの形か」
// という解釈の手間が生まれない。的サムネイル・サイズ表記と並べる独立した
// 要素として使う。
// 次の得点帯（色が変わる最初のリング）をどれだけ覗かせるかの比率
// （次のリングまでの距離に対する割合）。これが的の中心部だけを切り取った
// ものだと伝わるよう、少しだけ次の色を見せる。
const NEXT_RING_PEEK_RATIO = 0.15;

export function TargetFaceCenterDetail({
  rings,
  pixelWidth = 64,
}: {
  rings: TargetFaceRing[];
  pixelWidth?: number;
}) {
  const cluster = innerSameColorRings(rings);
  if (cluster.length === 0) return null;

  const clusterOuterRadius = cluster[cluster.length - 1].radius;
  const sorted = [...rings].sort((a, b) => a.radius - b.radius);
  const nextRing = sorted[cluster.length];
  const cropRadius = nextRing
    ? clusterOuterRadius +
      (nextRing.radius - clusterOuterRadius) * NEXT_RING_PEEK_RATIO
    : clusterOuterRadius;

  const strokeWidth = cropRadius * STROKE_WIDTH_RATIO;
  // strokeはパス（リング半径）を中心に太さの半分ずつ内外に描かれるため、
  // 最外リングの境界線がviewBoxの端で見切れないよう半分だけ余白を確保する
  // （TargetFaceIconと同じ考え方）。
  const viewExtent = cropRadius + strokeWidth / 2;
  const bandHalfHeight = viewExtent * CENTER_DETAIL_BAND_RATIO;
  const leftEdge = -viewExtent * CENTER_DETAIL_LEFT_MARGIN_RATIO;
  const cropWidth = viewExtent - leftEdge;
  const pixelHeight = pixelWidth * ((bandHalfHeight * 2) / cropWidth);
  // フォントサイズはpixelWidthではなくviewBoxと同じcm単位のスケールで指定する
  // 必要がある（そうしないと極端に巨大な文字になる）。
  const fontSize = clusterOuterRadius / 6;

  return (
    <svg
      viewBox={`${leftEdge} ${-bandHalfHeight} ${cropWidth} ${bandHalfHeight * 2}`}
      width={pixelWidth}
      height={pixelHeight}
      className="shrink-0 rounded-md border overflow-hidden"
      role="img"
      aria-label={cluster.map((r) => r.score_str).join(", ")}
    >
      {nextRing && (
        <circle
          cx={0}
          cy={0}
          r={nextRing.radius}
          fill={nextRing.color}
          stroke={nextRing.line_color ?? "none"}
          strokeWidth={nextRing.line_color ? strokeWidth : 0}
        />
      )}
      {[...cluster].reverse().map((r) => (
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
      {cluster.map((r, i) => {
        const innerEdge = i === 0 ? 0 : cluster[i - 1].radius;
        const mid = (innerEdge + r.radius) / 2;
        return (
          <text
            key={r.z_index}
            x={mid}
            y={0}
            dy="-0.06em"
            fontSize={fontSize}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#231F20"
          >
            {r.score_str}
          </text>
        );
      })}
      <line
        x1={-CENTER_CROSS_ARM_LENGTH_CM}
        y1={0}
        x2={CENTER_CROSS_ARM_LENGTH_CM}
        y2={0}
        stroke="#231F20"
        strokeWidth={CENTER_CROSS_STROKE_WIDTH_CM}
      />
      <line
        x1={0}
        y1={-CENTER_CROSS_ARM_LENGTH_CM}
        x2={0}
        y2={CENTER_CROSS_ARM_LENGTH_CM}
        stroke="#231F20"
        strokeWidth={CENTER_CROSS_STROKE_WIDTH_CM}
      />
    </svg>
  );
}

// 的の情報表示（サイズ・全体像・中心拡大）。距離ごとの情報行（プリセット選択・
// ラウンド詳細の距離一覧・的選択リスト）で共通して使う。サイズ表記を固定幅・
// 右寄せにすることで、桁数（60cmと122cm等）によらずTargetFaceInfo全体の
// 幅が常に一定になり、複数行に並べたときも画像の位置が自動的に揃う
// （呼び出し側で列を分解する必要がない）。
export function TargetFaceInfo({
  face,
  thumbnailSize = 48,
  centerDetailWidth = 68,
}: {
  face: { size: number; target_face_spots: TargetFaceSpotLayout[] } | null;
  thumbnailSize?: number;
  centerDetailWidth?: number;
}) {
  if (!face) {
    return <span>的未設定</span>;
  }

  return (
    <span className="flex items-center justify-center gap-1">
      <span className="inline-block w-12 text-right">{face.size}cm</span>
      <TargetFaceIcon spots={face.target_face_spots} size={thumbnailSize} />
      <TargetFaceCenterDetail
        rings={face.target_face_spots[0]?.target_face_rings ?? []}
        pixelWidth={centerDetailWidth}
      />
    </span>
  );
}
