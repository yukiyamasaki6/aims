import { FieldTarget } from "./field-target";
import { FIGURE_LINE, FIGURE_SIZE, FigureSvg } from "./figure-svg";
import { StandardTarget } from "./standard-target";
import { TargetMark } from "./target-mark";
import { TargetTriple, TRIPLE_HEIGHT_RATIO } from "./target-triple";

// 「自分のスタイルに合わせて、点数を記録」の図。記録の設定のフォームを表す。上の行に距離(18m・25m・50m・70m。50mは選択の枠)、中の行に的(10点的・6点的(選択の枠)・3つ目の6点的・フィールド的)、下の行に矢の本数(3本(選択の枠)・6本)を、4つの列に揃えて並べ、行の間に灰色の線を1本ずつ引く。
// 構成: Distances(距離の文字と選択の枠)・Targets(的4つと選択の枠)・Arrows(矢9本と選択の枠)・行の間の灰色の線2本。位置は、列の中心(COLUMNS)と行の中心(ROW_*。枠の大きさと行の間隔から導く)から決める。
// 座標はviewBox(1536×1024)のまま。線の太さは12。4つの列の中心は、横に等間隔。
const LINE = FIGURE_LINE;
const COLUMNS = [225, 600, 975, 1350];
// 的の大きさ(外接の高さ)。4つで同じ。
const TARGET_SIZE = 200;
const TARGET_RADIUS = TARGET_SIZE / 2;
// 的1つの半径(3つ目の6点的。外接の高さがTARGET_SIZEになる)。外接の高さは、的1つの半径の TRIPLE_HEIGHT_RATIO 倍(アプリの配置)。
const TRIPLE_RADIUS = TARGET_SIZE / TRIPLE_HEIGHT_RATIO;
// 距離の文字。アプリの距離の表示(`preset-info.tsx`の`DistanceInfo`)と同じフォント(ページのフォントを継承)・同じ太さ(標準)で、`<text>`で描く。大きさ(フォントの大きさ)から、数字の高さと、選択の枠の幅(「50m」の幅の実測値÷フォントの大きさ=DISTANCE_WIDTH)を導く。
const FONT_SIZE = 100;
const DIGIT_HEIGHT = FONT_SIZE * 0.71;
const DISTANCE_WIDTH = 2.15 * FONT_SIZE;
// 選択の枠: 中身の見た目の外縁から、枠の線の中心までの距離。角丸の半径は、3つの枠で同じ。
const FRAME_PAD = 40;
const FRAME_RADIUS = 55;
// 矢(同一の部品)。上向きで、見た目の高さは ARROW_VISUAL、並ぶ間隔は ARROW_PITCH。
const ARROW_VISUAL = 140;
const ARROW_PITCH = 100;
// 行の中心の高さ。行の間(各行の外縁どうしの間隔)は、行の間隔 ROW_GAP で、灰色の線は、その中央に引く。
const ROW_GAP = 100;
const TEXT_FRAME_HEIGHT = DIGIT_HEIGHT + FRAME_PAD * 2;
const TARGET_FRAME_SIZE = TARGET_SIZE + FRAME_PAD * 2;
const ARROW_FRAME_HEIGHT = ARROW_VISUAL + FRAME_PAD * 2;
// 3つの行の枠と行の間を合わせた高さを、viewBoxの縦の中央に置く。
const CONTENT_HEIGHT =
  TEXT_FRAME_HEIGHT +
  TARGET_FRAME_SIZE +
  ARROW_FRAME_HEIGHT +
  LINE * 3 +
  ROW_GAP * 2;
const TOP = (FIGURE_SIZE.height - CONTENT_HEIGHT) / 2;
const ROW_TEXT = TOP + (TEXT_FRAME_HEIGHT + LINE) / 2;
const ROW_TARGET =
  ROW_TEXT +
  (TEXT_FRAME_HEIGHT + LINE) / 2 +
  ROW_GAP +
  (TARGET_FRAME_SIZE + LINE) / 2;
const ROW_ARROW =
  ROW_TARGET +
  (TARGET_FRAME_SIZE + LINE) / 2 +
  ROW_GAP +
  (ARROW_FRAME_HEIGHT + LINE) / 2;
const SEPARATORS = [
  ROW_TEXT + (TEXT_FRAME_HEIGHT + LINE) / 2 + ROW_GAP / 2,
  ROW_TARGET + (TARGET_FRAME_SIZE + LINE) / 2 + ROW_GAP / 2,
];
// 矢の枠は、1列目と2列目にまたがり、左右の端は、的の枠の外縁(列の中心 ± 枠の大きさの半分)にそろえる。
const FRAME_HALF = (TARGET_FRAME_SIZE + LINE) / 2;
const ARROW_FRAME = {
  left: COLUMNS[0] - FRAME_HALF,
  right: COLUMNS[1] + FRAME_HALF,
};
// 灰色の線の、左右の端(外縁)。矢の枠の左端と、それに対して鏡像の位置。
const SEPARATOR_LEFT = ARROW_FRAME.left;
const SEPARATOR_RIGHT = FIGURE_SIZE.width - SEPARATOR_LEFT;
// 灰色の線は、図の線の色に不透明度を掛けた色
const SEPARATOR_OPACITY = 0.3;
const SEPARATOR_WIDTH = 6;

const DISTANCES = ["18m", "25m", "50m", "70m"];
const SELECTED_DISTANCE = 2;

// 角丸の枠(線の中心の位置で指定)
function Frame({
  cx,
  cy,
  width,
  height,
}: {
  cx: number;
  cy: number;
  width: number;
  height: number;
}) {
  return (
    <rect
      x={cx - width / 2}
      y={cy - height / 2}
      width={width}
      height={height}
      rx={FRAME_RADIUS}
    />
  );
}

// 矢の形は、ベース画像(10.webp)の矢を測った値から決めた(矢全体の高さ134.5に合わせた、矢の中心を原点とする座標)。
// 鏃: 先端が上の二等辺三角形(底辺の幅は羽根と同じ)。矢柄: 線。矢羽根: 上と下が山形(「^」)の、2段のシェブロンで、上の山形の肩から下端までは、鏃と同じ幅の矩形で、下端の中央に、上の山形と同じ傾きの谷がある。
// 矢の角の丸み(半径)。鏃の3つの角と、矢羽根の全ての角で同じ。
const ARROW_CORNER = 3;
const ARROW_HALF_WIDTH = 18.6;
const ARROW_HEAD = [
  [0, -81.3],
  [19.8, -41.7],
  [-19.8, -41.7],
] as const;
// 矢羽根: 上の山形の頂点、肩、下端、谷の幅と頂点
const ARROW_FLETCH_APEX = 11.2;
const ARROW_FLETCH_SHOULDER = 26.1;
const ARROW_BOTTOM = 58;
const ARROW_NOTCH = { halfWidth: 13.4, apex: 45.9 };
const ARROW_FLETCH = [
  [0, ARROW_FLETCH_APEX],
  [ARROW_HALF_WIDTH, ARROW_FLETCH_SHOULDER],
  [ARROW_HALF_WIDTH, ARROW_BOTTOM],
  [ARROW_NOTCH.halfWidth, ARROW_BOTTOM],
  [0, ARROW_NOTCH.apex],
  [-ARROW_NOTCH.halfWidth, ARROW_BOTTOM],
  [-ARROW_HALF_WIDTH, ARROW_BOTTOM],
  [-ARROW_HALF_WIDTH, ARROW_FLETCH_SHOULDER],
] as const;
// 矢柄(線)の、鏃の中から羽根の中までの範囲(上端・下端のy)
const ARROW_SHAFT = [-45, 20] as const;

type Point = readonly [number, number];

// 全ての角を半径radiusの円弧で丸めた多角形のパス
function roundedPolygon(points: readonly Point[], radius: number) {
  const unit = (from: Point, to: Point) => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    return [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
  };
  const corners = points.map((p, i) => {
    const prev = points[(i + points.length - 1) % points.length];
    const next = points[(i + 1) % points.length];
    const u1 = unit(p, prev);
    const u2 = unit(p, next);
    const cut = radius / Math.tan(Math.acos(u1[0] * u2[0] + u1[1] * u2[1]) / 2);
    const turn =
      (p[0] - prev[0]) * (next[1] - p[1]) - (p[1] - prev[1]) * (next[0] - p[0]);
    return `${p[0] + u1[0] * cut} ${p[1] + u1[1] * cut}A${radius} ${radius} 0 0 ${turn > 0 ? 1 : 0} ${p[0] + u2[0] * cut} ${p[1] + u2[1] * cut}`;
  });
  return `M${corners.join("L")}Z`;
}

// 矢1本。上向き。(x, y)は、見た目の高さの中央。鏃・矢柄(線)・矢羽根。鏃と矢羽根は、塗りだけで、角の丸みは ARROW_CORNER にそろえる。
function Arrow({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d={`M0 ${ARROW_SHAFT[0]}V${ARROW_SHAFT[1]}`} />
      <g fill="currentColor" stroke="none">
        <path d={roundedPolygon(ARROW_HEAD, ARROW_CORNER)} />
        <path d={roundedPolygon(ARROW_FLETCH, ARROW_CORNER)} />
      </g>
    </g>
  );
}

function Distances() {
  return (
    <g>
      <g
        fill="currentColor"
        stroke="none"
        fontSize={FONT_SIZE}
        fontWeight={400}
      >
        {DISTANCES.map((text, i) => (
          <text
            key={text}
            x={COLUMNS[i]}
            y={ROW_TEXT + DIGIT_HEIGHT / 2}
            textAnchor="middle"
          >
            {text}
          </text>
        ))}
      </g>
      <Frame
        cx={COLUMNS[SELECTED_DISTANCE]}
        cy={ROW_TEXT}
        width={DISTANCE_WIDTH + FRAME_PAD * 2}
        height={TEXT_FRAME_HEIGHT}
      />
    </g>
  );
}

function Targets() {
  return (
    <g>
      <StandardTarget x={COLUMNS[0]} y={ROW_TARGET} outer={TARGET_RADIUS} />
      <TargetMark
        variant="six"
        x={COLUMNS[1]}
        y={ROW_TARGET}
        radius={TARGET_RADIUS}
      />
      <Frame
        cx={COLUMNS[1]}
        cy={ROW_TARGET}
        width={TARGET_FRAME_SIZE}
        height={TARGET_FRAME_SIZE}
      />
      <TargetTriple x={COLUMNS[2]} y={ROW_TARGET} radius={TRIPLE_RADIUS} />
      <FieldTarget x={COLUMNS[3]} y={ROW_TARGET} outer={TARGET_RADIUS} />
    </g>
  );
}

// 矢の並び。枠つきの3本は1列目と2列目の中央、枠のない6本は3列目と4列目の中央に、等間隔で置く。
const ARROW_GROUPS = [
  { count: 3, center: (ARROW_FRAME.left + ARROW_FRAME.right) / 2 },
  { count: 6, center: (COLUMNS[2] + COLUMNS[3]) / 2 },
].map(({ count, center }) => ({
  id: `arrows-${count}`,
  xs: Array.from(
    { length: count },
    (_, i) => center + (i - (count - 1) / 2) * ARROW_PITCH,
  ),
}));

function Arrows() {
  return (
    <g>
      {ARROW_GROUPS.map(({ id, xs }) => (
        <g key={id}>
          {xs.map((x) => (
            <Arrow key={x} x={x} y={ROW_ARROW} />
          ))}
        </g>
      ))}
      <Frame
        cx={(ARROW_FRAME.left + ARROW_FRAME.right) / 2}
        cy={ROW_ARROW}
        width={ARROW_FRAME.right - ARROW_FRAME.left - LINE}
        height={ARROW_FRAME_HEIGHT}
      />
    </g>
  );
}

export function SetupFigure() {
  return (
    <FigureSvg>
      <path
        d={SEPARATORS.map(
          (y) =>
            `M${SEPARATOR_LEFT + SEPARATOR_WIDTH / 2} ${y}H${SEPARATOR_RIGHT - SEPARATOR_WIDTH / 2}`,
        ).join("")}
        strokeWidth={SEPARATOR_WIDTH}
        strokeOpacity={SEPARATOR_OPACITY}
      />
      <Distances />
      <Targets />
      <Arrows />
    </FigureSvg>
  );
}
