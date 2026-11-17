import { ArrowheadMarker } from "./arrowhead-marker";
import { FIGURE_CENTER, FIGURE_LINE, FigureSvg } from "./figure-svg";
import {
  PHONE_HEIGHT as PHONE_BASE_HEIGHT,
  PHONE_WIDTH as PHONE_BASE_WIDTH,
  PHONE_SCREEN_CENTER,
  PhoneFrame,
} from "./phone-frame";
import {
  PRESET_TRIPLE_RADIUS,
  PresetCard,
  presetCardHeight,
  presetCardRadius,
} from "./preset-card";
import { TargetTriple } from "./target-triple";

// 「いつものラウンドを、すぐに開始」の図。左下の点線の枠(+。プリセットを新しく作る)から、中央の重なったカード(プリセット。しおりと、的と、名前の線2本)へ矢印が向かい、カードから、右下のスマホ(選んだプリセットで始まる)へ矢印が向かう。
// 構成: AddFrame(点線の枠と+)・StackedCards(3枚のカード)・PhoneFrame・矢印2本。位置は、矢印1の終点(カードの縁)を基準に、矢印の差(ARROW*_DX・DY)から導く。
// 矢印の隙間(端と周りの要素との距離)は、4か所とも14にそろえる。
// 絵は基底の座標で描き、図全体を拡大率Kで拡大する。線の太さは、拡大率の逆数で補正して、図の座標で12にする。
const K = 1.231;
const LINE = FIGURE_LINE / K;
// 矢印の端と、周りの要素との隙間は、図の座標で14(カード03と同じ)。端から周りの要素の線の中心までは、隙間に線の太さを足した距離にする。
const REACH = (14 + FIGURE_LINE) / K;

// 重なった3枚のカード(角丸の枠)。後ろへ(STEP_X, STEP_Y)ずつずれ、左と上の縁だけが見える。
const CARD_WIDTH = 600;
const CARD_HEIGHT = presetCardHeight(CARD_WIDTH);
const CARD_RADIUS = presetCardRadius(CARD_WIDTH);
const STEP_X = 30;
const STEP_Y = 42;
const BACK_LEFT = 0;
const FRONT = { x: BACK_LEFT + STEP_X * 2, y: STEP_Y * 2 };

// スマホ(カード03・04と同じ PhoneFrame。寸法は、PhoneFrame の基準(幅・高さ)の PHONE_SCALE 倍)。
const PHONE_SCALE = 1.2;
const PHONE_WIDTH = PHONE_BASE_WIDTH * PHONE_SCALE;
const PHONE_HEIGHT = PHONE_BASE_HEIGHT * PHONE_SCALE;
// スマホの中の的(カード03・04と同じ中心。三角三つ目が、画面に収まる大きさ。radiusは、3つの的それぞれの半径)
const PHONE_TARGET = {
  x: PHONE_SCREEN_CENTER.x * PHONE_SCALE,
  y: PHONE_SCREEN_CENTER.y * PHONE_SCALE,
  radius: 22 * PHONE_SCALE,
};
// 点線の角丸の枠(正方形)。一辺はスマホの幅と同じ。周期は枠の1周に16回入り、点線の周期の中央が、上の辺の中心にくる。
const ADD_SIDE = PHONE_WIDTH;
const ADD_RADIUS = ADD_SIDE * 0.233;
const ADD_PLUS = ADD_SIDE * 0.244;

// 矢印は2本とも、単一の円弧(弧の角度 ARROW1_ANGLE・ARROW2_ANGLE、時計回り)。矢印1の始点は、枠の中心の真上、矢印2の終点は、スマホの中心の真上で、どちらも周りの要素との隙間が14。
// カード側の端の高さ END_Y は、2本で同じ。矢印1の終点は、いちばん後ろのカードの左の縁の左(隙間14)、矢印2の始点は、最前面のカードの右の縁の右(隙間14)で、どちらも縁のまっすぐな部分(END_Y は、その共通の範囲に入る)。
// 矢印1の始点は、終点から左へ ARROW1_DX・下へ ARROW1_DY。矢印2の終点は、始点から右へ ARROW2_DX・下へ ARROW2_DY。枠とスマホの中心の高さが同じで、枠がスマホより縦が短いので、ARROW2_DY は ARROW1_DY より、その差の半分だけ短い。
const END_Y = 180;
const ARROW1_DX = 120;
const ARROW1_DY = 175;
const ARROW1_ANGLE = 65;
const ARROW2_DX = 120;
const ARROW2_ANGLE = 50;
const ARROW2_DY = ARROW1_DY - (PHONE_HEIGHT - ADD_SIDE) / 2;
const ARROW_END = { x: BACK_LEFT - REACH, y: END_Y };
const ARROW_START = {
  x: ARROW_END.x - ARROW1_DX,
  y: END_Y + ARROW1_DY,
};
const ADD_CENTER = {
  x: ARROW_START.x,
  y: ARROW_START.y + REACH + ADD_SIDE / 2,
};
const PHONE_Y = ADD_CENTER.y - PHONE_HEIGHT / 2;
const ARROW2_END_Y = PHONE_Y - REACH;
const ARROW2_START = {
  x: FRONT.x + CARD_WIDTH + REACH,
  y: END_Y,
};
const PHONE_CENTER_X = ARROW2_START.x + ARROW2_DX;
const PHONE_X = PHONE_CENTER_X - PHONE_WIDTH / 2;
// 軸の円弧の半径。2点を結ぶ弦と、弧の角度(度)から決まる。
const arcRadius = (dx: number, dy: number, angle: number) =>
  Math.hypot(dx, dy) / (2 * Math.sin((angle * Math.PI) / 360));

const ARROW1_RADIUS = arcRadius(ARROW1_DX, ARROW1_DY, ARROW1_ANGLE);
const ARROW2_RADIUS = arcRadius(ARROW2_DX, ARROW2_DY, ARROW2_ANGLE);
const ARROW_PATHS = [
  `M${ARROW_START.x} ${ARROW_START.y}A${ARROW1_RADIUS} ${ARROW1_RADIUS} 0 0 1 ${ARROW_END.x} ${ARROW_END.y}`,
  `M${ARROW2_START.x} ${ARROW2_START.y}A${ARROW2_RADIUS} ${ARROW2_RADIUS} 0 0 1 ${PHONE_CENTER_X} ${ARROW2_END_Y}`,
];

// 図の範囲(基底の座標)を、viewBoxの中央に置く。
const TOP = -LINE / 2;
const BOTTOM = PHONE_Y + PHONE_HEIGHT + LINE / 2;
const LEFT = ADD_CENTER.x - ADD_SIDE / 2 - LINE / 2;
const RIGHT = PHONE_CENTER_X + PHONE_WIDTH / 2 + LINE / 2;
const TRANSLATE_X = FIGURE_CENTER.x - (K * (LEFT + RIGHT)) / 2;
const TRANSLATE_Y = FIGURE_CENTER.y - (K * (TOP + BOTTOM)) / 2;

// 重なった3枚のカード。後ろの2枚は枠だけで、最前面のカードにだけ、しおり・的(三つ目)・名前の線2本を描く。
function StackedCards() {
  const origins = [0, 1].map((i) => ({
    x: BACK_LEFT + STEP_X * i,
    y: STEP_Y * i,
  }));
  return (
    <g>
      {origins.map((o) => (
        <rect
          key={o.x}
          x={o.x}
          y={o.y}
          width={CARD_WIDTH}
          height={CARD_HEIGHT}
          rx={CARD_RADIUS}
          fill="var(--background)"
        />
      ))}
      <PresetCard
        x={FRONT.x}
        y={FRONT.y}
        width={CARD_WIDTH}
        bookmark
        target={(at) => (
          <TargetTriple
            x={at.x}
            y={at.y}
            radius={at.height * PRESET_TRIPLE_RADIUS}
          />
        )}
      />
    </g>
  );
}

// 点線の枠と「＋」
function AddFrame() {
  const { x, y } = ADD_CENTER;
  const r = ADD_RADIUS;
  const half = ADD_SIDE / 2;
  const [left, right, top, bottom] = [x - half, x + half, y - half, y + half];
  const d = `M${x} ${top}H${right - r}A${r} ${r} 0 0 1 ${right} ${top + r}V${bottom - r}A${r} ${r} 0 0 1 ${right - r} ${bottom}H${left + r}A${r} ${r} 0 0 1 ${left} ${bottom - r}V${top + r}A${r} ${r} 0 0 1 ${left + r} ${top}H${x}`;
  return (
    <g>
      <path
        d={d}
        pathLength="1600"
        strokeDasharray="40 60"
        strokeDashoffset="20"
      />
      <path
        d={`M${x - ADD_PLUS} ${y}H${x + ADD_PLUS}M${x} ${y - ADD_PLUS}V${y + ADD_PLUS}`}
      />
    </g>
  );
}

export function PresetFigure() {
  return (
    <FigureSvg>
      <defs>
        <ArrowheadMarker id="preset-figure-arrowhead" k={K} />
      </defs>
      <g
        transform={`translate(${TRANSLATE_X} ${TRANSLATE_Y}) scale(${K})`}
        strokeWidth={LINE}
      >
        <AddFrame />
        <StackedCards />
        <PhoneFrame x={PHONE_X} y={PHONE_Y} scale={PHONE_SCALE}>
          <TargetTriple
            x={PHONE_X + PHONE_TARGET.x}
            y={PHONE_Y + PHONE_TARGET.y}
            radius={PHONE_TARGET.radius}
          />
        </PhoneFrame>
        {ARROW_PATHS.map((d) => (
          <path key={d} d={d} markerEnd="url(#preset-figure-arrowhead)" />
        ))}
      </g>
    </FigureSvg>
  );
}
