import type { ReactNode } from "react";

// 紹介のカードの図に共通の、svgの枠と寸法。線の太さは12、色は`currentColor`、装飾なので支援技術から隠す。
export const FIGURE_LINE = 12;
// 図の枠(`IntroCard`の図の背景)の色。図の中で、枠の背景と同じ見た目にしたい塗り(木・茂みなど)も、この値を使う。
export const FIGURE_BACKGROUND = "var(--muted)";
// 図の座標(viewBox)の大きさ(3:2)と、その中央
export const FIGURE_SIZE = { width: 1536, height: 1024 } as const;
export const FIGURE_CENTER = {
  x: FIGURE_SIZE.width / 2,
  y: FIGURE_SIZE.height / 2,
} as const;

type FigureSvgProps = {
  // viewBoxの大きさ(省略すると FIGURE_SIZE)
  size?: { readonly width: number; readonly height: number };
  children: ReactNode;
};

export function FigureSvg({ size = FIGURE_SIZE, children }: FigureSvgProps) {
  return (
    <svg
      viewBox={`0 0 ${size.width} ${size.height}`}
      className="h-auto w-full max-w-[300px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={FIGURE_LINE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}
