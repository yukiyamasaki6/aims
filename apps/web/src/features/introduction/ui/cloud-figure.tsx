import type { ReactNode } from "react";
import { ArrowheadMarker } from "./arrowhead-marker";
import { FIGURE_CENTER, FIGURE_LINE, FigureSvg } from "./figure-svg";
import {
  PHONE_HEIGHT,
  PHONE_SCREEN_CENTER,
  PHONE_WIDTH,
  PhoneFrame,
} from "./phone-frame";
import { PRESET_TARGET_HEIGHT, PresetCard } from "./preset-card";
import { StandardTarget } from "./standard-target";

// 「スマホで記録して、PCで振り返る」の図。左のスマホから、上のクラウド(プリセットのカード1枚)を経て、右のノートPCへ、矢印でつなぐ。
// 構成: Phone・Cloud(クラウドの輪郭と、プリセットのカード)・Laptop・矢印2本。まとまりごとに、自然な座標のまま Group で拡大する。位置は、クラウドの輪郭の矢印の端から導く。
// 配置: クラウドを上の中央、スマホを左下、ノートPCを右下に置く。各まとまりは、元の形の座標(自然な座標)のまま、拡大率だけで拡大する。
// 絵は設計の座標(クラウドの左上を原点)で描き、全体を拡大率Kで拡大して、viewBoxの中央に置く。線の太さは、拡大率の逆数で補正して、図の座標で12にする。
const K = 1.295;
const LINE = FIGURE_LINE;
// 矢印の端と、周りの要素との隙間は、図の座標で14。端から周りの要素の線の中心までは、隙間に線の太さを足した距離にする。
const REACH = (14 + FIGURE_LINE) / K;

// クラウドの輪郭(半径の違う円弧4つ)。自然な座標の外接の範囲は、横554〜982.7・縦201.8〜478。
const CLOUD_PATH =
  "M642 478H917A64 64 0 0 0 950 358.2A74 74 0 0 0 858 284A110 110 0 0 0 642 302A88 88 0 0 0 642 478Z";
const CLOUD_BOX = { left: 554, top: 201.8, right: 982.7, bottom: 478 };
const CLOUD_SCALE = 0.9;
// 矢印の端が当たる、クラウドの輪郭の円弧(左の円弧と右の円弧)の中心と半径(自然な座標)
const CLOUD_LEFT_ARC = { x: 642, y: 390, radius: 88 };
const CLOUD_RIGHT_ARC = { x: 918.6975, y: 414.0225, radius: 64 };
// クラウドの中のプリセットのカード(しおりなし。自然な座標)。クラウドの輪郭との余白が均等になる位置と大きさ。
const CARD = { x: 623, y: 321.5, width: 290 };

// 矢印1(スマホ→クラウド)は、スマホの真上から垂直に出て、クラウドの左の円弧の角度 ARROW1_ANGLE(度。180が真左、下向きが増える向き)の点に、輪郭の法線方向から入る。矢印2(クラウド→ノートPC)は、右の円弧の角度 ARROW2_ANGLE(0が真右)の点から、輪郭の法線方向に出て、ノートPCの真上に垂直に降りる。
// どちらも単一の円弧で、半径は ARROW1_RADIUS・ARROW2_RADIUS。端の位置は、輪郭から隙間14の位置。
const ARROW1_ANGLE = 170;
const ARROW1_RADIUS = 160;
const ARROW2_ANGLE = 10;
const ARROW2_RADIUS = 160;
const PHONE_SCALE = 1.3;
const LAPTOP_SCALE = 1.4;

const rad = (degrees: number) => (degrees * Math.PI) / 180;
// クラウドの自然な座標を、設計の座標にする。
const cloudAt = (x: number, y: number) => ({
  x: (x - CLOUD_BOX.left) * CLOUD_SCALE,
  y: (y - CLOUD_BOX.top) * CLOUD_SCALE,
});
// 円弧の上の点から、法線方向に隙間14だけ離れた点(設計の座標)
const outside = (
  arc: { x: number; y: number; radius: number },
  angle: number,
) => {
  const nx = Math.cos(rad(angle));
  const ny = Math.sin(rad(angle));
  const p = cloudAt(arc.x + arc.radius * nx, arc.y + arc.radius * ny);
  return { x: p.x + REACH * nx, y: p.y + REACH * ny };
};
// 矢印1の終点と、始点(終点から、垂直に出る円弧の分だけ左・下)。入る向きの水平からの角度は、法線の反対向き。
const ARROW1_END = outside(CLOUD_LEFT_ARC, ARROW1_ANGLE);
const ARROW1_ENTRY = rad(180 - ARROW1_ANGLE);
const ARROW1_START = {
  x: ARROW1_END.x - ARROW1_RADIUS * (1 - Math.sin(ARROW1_ENTRY)),
  y: ARROW1_END.y + ARROW1_RADIUS * Math.cos(ARROW1_ENTRY),
};
// 矢印2の始点と、終点(始点から、垂直に降りる円弧の分だけ右・下)
const ARROW2_START = outside(CLOUD_RIGHT_ARC, ARROW2_ANGLE);
const ARROW2_END = {
  x: ARROW2_START.x + ARROW2_RADIUS * (1 - Math.sin(rad(ARROW2_ANGLE))),
  y: ARROW2_START.y + ARROW2_RADIUS * Math.cos(rad(ARROW2_ANGLE)),
};

// スマホ(自然な座標は、PhoneFrame の基準。左上が原点)。上の辺の中心が、矢印1の始点の真下(隙間14)にくる。
const PHONE = {
  width: PHONE_WIDTH,
  height: PHONE_HEIGHT,
  left: ARROW1_START.x - (PHONE_WIDTH * PHONE_SCALE) / 2,
  top: ARROW1_START.y + REACH,
};
// ノートPC(自然な座標の、画面の上の辺の中心は x=1153、上の辺の線の中心は y=625、下端は 847、土台の半幅は 167)。上の辺の中心が、矢印2の終点の真下(隙間14)にくる。
const LAPTOP = { centerX: 1153, top: 625, bottom: 847, halfWidth: 167 };
const LAPTOP_ORIGIN = {
  x: ARROW2_END.x - LAPTOP.centerX * LAPTOP_SCALE,
  y: ARROW2_END.y + REACH - LAPTOP.top * LAPTOP_SCALE,
};

// 図全体の範囲(設計の座標)を、viewBoxの中央に置く。
const HALF_LINE = LINE / 2 / K;
const LEFT = Math.min(0, PHONE.left) - HALF_LINE;
const RIGHT =
  Math.max(
    (CLOUD_BOX.right - CLOUD_BOX.left) * CLOUD_SCALE,
    LAPTOP_ORIGIN.x + (LAPTOP.centerX + LAPTOP.halfWidth) * LAPTOP_SCALE,
  ) + HALF_LINE;
const TOP = -HALF_LINE;
const BOTTOM =
  Math.max(
    PHONE.top + PHONE.height * PHONE_SCALE,
    LAPTOP_ORIGIN.y + LAPTOP.bottom * LAPTOP_SCALE,
    (CLOUD_BOX.bottom - CLOUD_BOX.top) * CLOUD_SCALE,
  ) + HALF_LINE;
const TRANSLATE_X = FIGURE_CENTER.x - (K * (LEFT + RIGHT)) / 2;
const TRANSLATE_Y = FIGURE_CENTER.y - (K * (TOP + BOTTOM)) / 2;

const ARROW_PATHS = [
  `M${ARROW1_START.x} ${ARROW1_START.y}A${ARROW1_RADIUS} ${ARROW1_RADIUS} 0 0 1 ${ARROW1_END.x} ${ARROW1_END.y}`,
  `M${ARROW2_START.x} ${ARROW2_START.y}A${ARROW2_RADIUS} ${ARROW2_RADIUS} 0 0 1 ${ARROW2_END.x} ${ARROW2_END.y}`,
];

// 拡大率scaleの、自然な座標のまとまり。線の太さは、拡大率の逆数で補正する。
function Group({
  x,
  y,
  scale,
  children,
}: {
  x: number;
  y: number;
  scale: number;
  children: ReactNode;
}) {
  return (
    <g
      transform={`translate(${x} ${y}) scale(${scale})`}
      strokeWidth={LINE / (K * scale)}
    >
      {children}
    </g>
  );
}

function Phone() {
  return (
    <Group x={PHONE.left} y={PHONE.top} scale={PHONE_SCALE}>
      <PhoneFrame x={0} y={0}>
        <StandardTarget
          x={PHONE_SCREEN_CENTER.x}
          y={PHONE_SCREEN_CENTER.y}
          outer={43.5}
          k={1 / (K * PHONE_SCALE)}
        />
      </PhoneFrame>
    </Group>
  );
}

function Cloud() {
  return (
    <Group
      x={-CLOUD_BOX.left * CLOUD_SCALE}
      y={-CLOUD_BOX.top * CLOUD_SCALE}
      scale={CLOUD_SCALE}
    >
      <path d={CLOUD_PATH} fill="var(--background)" />
      <PresetCard
        x={CARD.x}
        y={CARD.y}
        width={CARD.width}
        bookmark={false}
        target={(at) => (
          <StandardTarget
            x={at.x}
            y={at.y}
            outer={(at.height * PRESET_TARGET_HEIGHT) / 2}
            k={1 / (K * CLOUD_SCALE)}
          />
        )}
      />
    </Group>
  );
}

function Laptop() {
  return (
    <Group x={LAPTOP_ORIGIN.x} y={LAPTOP_ORIGIN.y} scale={LAPTOP_SCALE}>
      <path d="M1002 805V645A20 20 0 0 1 1022 625H1284A20 20 0 0 1 1304 645V805" />
      <path d="M1024 805V654Q1024 649 1029 649H1277Q1282 649 1282 654V805" />
      <rect
        x="1030"
        y="655"
        width="246"
        height="144"
        fill="var(--background)"
        stroke="none"
      />
      <StandardTarget
        x={1103.5}
        y={725.5}
        outer={56}
        k={1 / (K * LAPTOP_SCALE)}
      />
      <path d="M1174 697H1253M1174 722H1253M1174 747H1235" />
      <rect
        x="986"
        y="805"
        width="334"
        height="42"
        rx="21"
        fill="var(--background)"
      />
      <path d="M1111 805C1113 822 1116 826 1126 826H1180C1190 826 1193 822 1195 805" />
    </Group>
  );
}

export function CloudFigure() {
  return (
    <FigureSvg>
      <defs>
        <ArrowheadMarker id="cloud-figure-arrowhead" k={K} />
      </defs>
      <g
        transform={`translate(${TRANSLATE_X} ${TRANSLATE_Y}) scale(${K})`}
        strokeWidth={LINE / K}
      >
        <Phone />
        <Cloud />
        <Laptop />
        {ARROW_PATHS.map((d) => (
          <path key={d} d={d} markerEnd="url(#cloud-figure-arrowhead)" />
        ))}
      </g>
    </FigureSvg>
  );
}
