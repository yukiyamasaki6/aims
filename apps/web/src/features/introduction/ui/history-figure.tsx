import { FIGURE_CENTER, FIGURE_LINE, FigureSvg } from "./figure-svg";
import {
  PRESET_TARGET_HEIGHT,
  PresetCard,
  presetCardHeight,
} from "./preset-card";
import { StandardTarget } from "./standard-target";

// 「記録を振り返り、次の練習のヒントに」の図。中央の一覧(奥へ向かって小さくなるプリセットのカードの並び)から、的で絞り込んで、カードを2枚、右へ横にずらして取り出している。
// 構成: slots(スロットの大きさと位置)→ placed(残る行と、取り出したカードの位置)→ ORDER(描く順)。
// 全て、プリセットの共通部品(`preset-card.tsx`)で、全体(枠・内容)を描く。隠れるのは、手前に描いた別のカードが上に重なる部分だけ(描画順だけで表現する)。取り出したスロットには、カードを描かない(空き)。
// 図の座標(viewBox 1536×1024)をそのまま使い、線の太さは12。一覧の中心を x=0、最前面のカードの下端を y=0 として組み、最後に、図全体を viewBox の中央に置く。
// 一覧のスロット(手前から数える)。奥のスロットほど、1段ごとに RATIO 倍に小さくなり、手前のカードに重なって、上の STRIP の割合だけが見える。
const SLOTS = 6;
const RATIO = 0.92;
const STRIP = 0.45;
// 最前面のカード(スロット0)の幅
const FRONT_WIDTH = 700;
// 取り出すスロット(的で絞り込んだカード)。元のスロットと同じ大きさ・同じ高さのまま、右へ横にずらす。
const EXTRACTED = [1, 4];
// 取り出したカードが、直前の手前のスロットのカードと重なる量(取り出したカードの幅に対する割合。横も縦も同じ)
const OVERLAP = 0.12;
const LINE = FIGURE_LINE;

const slots = (() => {
  let top = 0;
  return Array.from({ length: SLOTS }, (_, j) => {
    const width = FRONT_WIDTH * RATIO ** j;
    const height = presetCardHeight(width);
    top = j === 0 ? -height : top - STRIP * height;
    return { j, width, height, top };
  });
})();

// 全てのカード(残る行と、取り出したカード)を、元のスロットの順(奥のスロットから、手前のスロットの順)に描く。前後関係(重なる順序)は、元のスロットの順のまま変えない。
// 取り出したカードは、元のスロットの大きさのまま、右へずらして、少し上へ持ち上げる。直前の手前のスロット(一覧に残るカード)の右上の角に、正方形で重なる(横の重なり=縦の重なり=自分の幅の OVERLAP 倍)。手前のスロットのカードには、重なる部分で隠される。
type Card = (typeof slots)[number] & {
  center: number;
  side: 0 | 1;
};
const placed: Card[] = [];
for (const slot of slots) {
  const extracted = EXTRACTED.includes(slot.j);
  const front = placed.filter((c) => c.side === 0).at(-1);
  if (extracted && front) {
    const overlap = OVERLAP * slot.width;
    placed.push({
      ...slot,
      center: front.center + front.width / 2 - overlap + slot.width / 2,
      top: front.top + overlap - slot.height,
      side: 1,
    });
  } else {
    placed.push({ ...slot, center: 0, side: 0 });
  }
}
const SIDE_CARDS = placed.filter((c) => c.side === 1);
// 描く順(奥のスロットから)
const ORDER = [...placed].reverse();

// 図全体の範囲
const HALF = LINE / 2;
const LEFT = Math.min(
  -FRONT_WIDTH / 2,
  ...SIDE_CARDS.map((c) => c.center - c.width / 2),
);
const RIGHT = Math.max(
  FRONT_WIDTH / 2,
  ...SIDE_CARDS.map((c) => c.center + c.width / 2),
);
const TOP = Math.min(...placed.map((r) => r.top)) - HALF;
const BOTTOM = HALF;
const TRANSLATE_X = FIGURE_CENTER.x - (LEFT + RIGHT) / 2;
const TRANSLATE_Y = FIGURE_CENTER.y - (TOP + BOTTOM) / 2;

export function HistoryFigure() {
  return (
    <FigureSvg>
      <g transform={`translate(${TRANSLATE_X} ${TRANSLATE_Y})`}>
        {ORDER.map((card) => (
          <PresetCard
            key={card.j}
            x={card.center - card.width / 2}
            y={card.top}
            width={card.width}
            bookmark={false}
            target={
              card.side === 0
                ? undefined
                : (at) => (
                    <StandardTarget
                      x={at.x}
                      y={at.y}
                      outer={(at.height * PRESET_TARGET_HEIGHT) / 2}
                    />
                  )
            }
          />
        ))}
      </g>
    </FigureSvg>
  );
}
