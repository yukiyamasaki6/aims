import type { ReactNode } from "react";

// 図の中のスマホ。幅153・高さ259を基準の寸法とし、位置・長さ・半径だけをscaleで拡大する(線の太さは親のSVGの値のまま)。
// 左上の座標(x, y)を渡す。画面の内側に置く的などはchildrenで渡し、文字行の手前に描く。
export const PHONE_WIDTH = 153;
export const PHONE_HEIGHT = 259;
// 画面の中央(的などを置く位置。基準の寸法での座標)
export const PHONE_SCREEN_CENTER = { x: 76.5, y: 101.5 } as const;
const RADIUS = 24;
// 画面内の文字行(左端・1本目の右端・2本目の右端・1本目の高さ・2本目の高さ)。2本目は1本目の約80%の長さ。
const LINE_LEFT = 34;
const LINE_RIGHT = 119;
const LINE_SECOND_RIGHT = 102;
const LINE_FIRST = 163;
const LINE_SECOND = 195;
// 上部の切り欠き(左端・右端・下端と、角の丸みの位置)
const NOTCH_LEFT = 39;
const NOTCH_RIGHT = 114;
const NOTCH_DEPTH = 27;
const NOTCH_BEND = 17;
const NOTCH_CORNER = 18;

type PhoneFrameProps = {
  x: number;
  y: number;
  scale?: number;
  children?: ReactNode;
};

export function PhoneFrame({ x, y, scale = 1, children }: PhoneFrameProps) {
  const at = (px: number, py: number) => `${x + px * scale} ${y + py * scale}`;
  const notch = [
    `M${at(NOTCH_LEFT, 0)}`,
    `C${at(NOTCH_LEFT, NOTCH_BEND)} ${at(NOTCH_LEFT + 6, NOTCH_DEPTH)} ${at(NOTCH_LEFT + NOTCH_CORNER, NOTCH_DEPTH)}`,
    `H${x + (NOTCH_RIGHT - NOTCH_CORNER) * scale}`,
    `C${at(NOTCH_RIGHT - 6, NOTCH_DEPTH)} ${at(NOTCH_RIGHT, NOTCH_BEND)} ${at(NOTCH_RIGHT, 0)}`,
  ].join("");
  const lines = [
    `M${at(LINE_LEFT, LINE_FIRST)}H${x + LINE_RIGHT * scale}`,
    `M${at(LINE_LEFT, LINE_SECOND)}H${x + LINE_SECOND_RIGHT * scale}`,
  ].join("");
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={PHONE_WIDTH * scale}
        height={PHONE_HEIGHT * scale}
        rx={RADIUS * scale}
        fill="var(--background)"
      />
      <path d={notch} />
      {children}
      <path d={lines} />
    </g>
  );
}
