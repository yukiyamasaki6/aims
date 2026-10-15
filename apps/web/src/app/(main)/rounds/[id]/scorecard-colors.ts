import {
  type ScoringTargetFace,
  scoreKeysFor,
} from "@/features/rounds/scorecard-scoring";

export function contrastText(hex: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#231F20" : "#FFFFFF";
}

// 記録済みの玉の点数の実際のリング色を、テンキーと同じキー構成から引く。
// Mや的に無い点数は、的の外を表すM（キー構成の末尾）の色とする。
export function ringColorFor(
  targetFace: ScoringTargetFace | undefined,
  scoreStr: string,
): string {
  const keys = scoreKeysFor(targetFace);
  const key =
    keys.find((k) => k.scoreStr === scoreStr) ?? keys[keys.length - 1];
  return key.color;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const diff = max - min;
  if (diff === 0) return [0, 0, l];

  const s = l > 0.5 ? diff / (2 - max - min) : diff / (max + min);
  let h: number;
  if (max === rn) {
    h = ((gn - bn) / diff) % 6;
  } else if (max === gn) {
    h = (bn - rn) / diff + 2;
  } else {
    h = (rn - gn) / diff + 4;
  }
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

// 的の実際のリング色から、同じ色相・彩度のまま明度だけを上げた薄いトーンを
// 生成する。固定の配色テーブルを持たないことで、任意の的の配色（フィールド的
// 等、標準のWAしきい値と対応しない配色を含む）にそのまま追従できる。
// 背景は常に薄い色になるため、文字色は輝度判定不要で固定の黒でよい。
export function paleTone(hex: string): { bg: string; fg: string } {
  const [h, s] = rgbToHsl(...hexToRgb(hex));
  return {
    bg: hslToHex(h, s, 0.9),
    fg: "#231F20",
  };
}
