// @vitest-environment node
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

// 設計の寸法。画像の幅に対する割合。
const RING_DIAMETER = 0.533;
const DOT_DIAMETER = 0.1778;
const BAR_THICKNESS = 0.0889;
const BAR_RIGHT_END = 0.8333; // 中心から33.3%
const BAR_MEASURE_COL = 0.3; // 環の外縁(26.65%)と棒の右端(33.3%)の間
const MAX_BAR_OVERSHOOT = 0.03; // 追加の丸からのはみ出しの上限
const TOLERANCE = 0.006;
// 「ホーム画面に追加」の丸の半径(画像の幅に対する割合)と、必要な余裕。
const ADD_CIRCLE_RADIUS = 0.31;
const MIN_MARGIN = 0.03;
// iOS用のapple-iconは縮小しない(環の直径が幅の80%、赤い円が26.67%)。
const APPLE_SIZE = 180;
const APPLE_RING_DIAMETER = 0.8;
const APPLE_DOT_DIAMETER = 0.2667;

const ICONS = [
  { file: "../../public/icons/icon-192.png", size: 192 },
  { file: "../../public/icons/icon-512.png", size: 512 },
  { file: "../../public/icons/icon-192-maskable.png", size: 192 },
  { file: "../../public/icons/icon-512-maskable.png", size: 512 },
] as const;

type Raster = { data: Buffer; size: number; channels: number };

async function load(file: string): Promise<Raster> {
  const path = fileURLToPath(new URL(file, import.meta.url));
  const { data, info } = await sharp(path)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, size: info.width, channels: info.channels };
}

function px(r: Raster, x: number, y: number) {
  const i = (y * r.size + x) * r.channels;
  return {
    r: r.data[i],
    g: r.data[i + 1],
    b: r.data[i + 2],
    a: r.channels === 4 ? r.data[i + 3] : 255,
  };
}

const isDark = (p: { r: number; g: number; b: number }) =>
  p.r < 128 && p.g < 128 && p.b < 128;
const isRed = (p: { r: number; g: number; b: number }) =>
  p.r > 200 && p.g < 100 && p.b < 80;

function minAlpha(r: Raster) {
  let min = 255;
  for (let y = 0; y < r.size; y++)
    for (let x = 0; x < r.size; x++) min = Math.min(min, px(r, x, y).a);
  return min;
}

function cornerColors(r: Raster) {
  const e = r.size - 1;
  return [px(r, 0, 0), px(r, e, 0), px(r, 0, e), px(r, e, e)].map((p) => [
    p.r,
    p.g,
    p.b,
  ]);
}

// 中心の列で、暗い画素の最上段から最下段までの長さ。
function ringDiameter(r: Raster) {
  const c = Math.floor(r.size / 2);
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < r.size; y++) {
    if (!isDark(px(r, c, y))) continue;
    if (top < 0) top = y;
    bottom = y;
  }
  return bottom - top + 1;
}

// 中心の行・列を基準に、条件を満たす画素の連続長を数える。
function runLength(
  size: number,
  from: number,
  at: (i: number) => { r: number; g: number; b: number },
  test: (p: { r: number; g: number; b: number }) => boolean,
) {
  let lo = from;
  let hi = from;
  while (lo > 0 && test(at(lo - 1))) lo--;
  while (hi < size - 1 && test(at(hi + 1))) hi++;
  return hi - lo + 1;
}

describe.each(ICONS)("インストール用アイコン $file", ({ file, size }) => {
  it("寸法が名前どおりで、全画素が不透明、四隅が白である", async () => {
    // Given: 生成済みの画像
    const img = await load(file);

    // When: 寸法・アルファ・四隅を読む
    const corners = [
      px(img, 0, 0),
      px(img, size - 1, 0),
      px(img, 0, size - 1),
      px(img, size - 1, size - 1),
    ];
    let minAlpha = 255;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        minAlpha = Math.min(minAlpha, px(img, x, y).a);

    // Then: 期待の寸法で、透明な画素がなく、四隅が白
    expect(img.size).toBe(size);
    expect(minAlpha).toBe(255);
    for (const c of corners) expect([c.r, c.g, c.b]).toEqual([255, 255, 255]);
  });

  it("環の直径が画像の幅の53.3%(±0.6ポイント)である", async () => {
    // Given: 生成済みの画像
    const img = await load(file);
    const c = Math.floor(size / 2);

    // When: 中心の列で、暗い画素の最上段から最下段までを測る
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < size; y++) {
      if (isDark(px(img, c, y))) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    const diameter = bottom - top + 1;

    // Then: 設計の53.3%に収まる
    expect(diameter).toBeGreaterThanOrEqual(size * (RING_DIAMETER - TOLERANCE));
    expect(diameter).toBeLessThanOrEqual(size * (RING_DIAMETER + TOLERANCE));
  });

  it("中心の赤い円の直径が画像の幅の17.8%(±0.6ポイント)である", async () => {
    // Given: 生成済みの画像
    const img = await load(file);
    const c = Math.floor(size / 2);

    // When: 中心の画素と、中心の行の赤い画素の連続長を測る
    const center = px(img, c, c);
    const diameter = runLength(size, c, (x) => px(img, x, c), isRed);

    // Then: 中心が赤で、直径が設計どおり
    expect(isRed(center)).toBe(true);
    expect(diameter).toBeGreaterThanOrEqual(size * (DOT_DIAMETER - TOLERANCE));
    expect(diameter).toBeLessThanOrEqual(size * (DOT_DIAMETER + TOLERANCE));
  });

  it("棒の太さが画像の幅の8.9%(±0.6ポイント)である", async () => {
    // Given: 生成済みの画像
    const img = await load(file);
    const c = Math.floor(size / 2);
    const col = c + Math.round(size * BAR_MEASURE_COL);

    // When: 環の外で棒だけがある列の、暗い画素の連続長を測る
    const centerPixel = px(img, col, c);
    const thickness = runLength(size, c, (y) => px(img, col, y), isDark);

    // Then: その列の中心が暗く、太さが設計どおり
    expect(isDark(centerPixel)).toBe(true);
    expect(thickness).toBeGreaterThanOrEqual(
      size * (BAR_THICKNESS - TOLERANCE),
    );
    expect(thickness).toBeLessThanOrEqual(size * (BAR_THICKNESS + TOLERANCE));
  });

  it("棒の右端が画像の幅の83.3%(±0.6ポイント)の位置にあり、画像の端に届かない", async () => {
    // Given: 生成済みの画像
    const img = await load(file);
    const c = Math.floor(size / 2);

    // When: 中心の行で、最も右の暗い画素の位置を測る
    let rightmost = -1;
    for (let x = 0; x < size; x++) if (isDark(px(img, x, c))) rightmost = x;
    const end = rightmost + 1;
    const edge = px(img, size - 1, c);

    // Then: 設計の位置で、最右列の中心は白
    expect(end).toBeGreaterThanOrEqual(size * (BAR_RIGHT_END - TOLERANCE));
    expect(end).toBeLessThanOrEqual(size * (BAR_RIGHT_END + TOLERANCE));
    expect([edge.r, edge.g, edge.b]).toEqual([255, 255, 255]);
  });

  it("棒の右端の「ホーム画面に追加」の丸からのはみ出しが3ポイント以下である", async () => {
    // Given: 生成済みの画像
    const img = await load(file);
    const c = Math.floor(size / 2);

    // When: 棒の右端の、中心からの距離と丸の半径の差を測る
    let rightmost = -1;
    for (let x = 0; x < size; x++) if (isDark(px(img, x, c))) rightmost = x;
    const overshoot = rightmost + 1 - c - size * ADD_CIRCLE_RADIUS;

    // Then: 認める範囲(約2.3〜2.7ポイント)を超えない
    expect(overshoot).toBeLessThanOrEqual(size * MAX_BAR_OVERSHOOT);
  });

  it("環が「ホーム画面に追加」の丸より3ポイント以上内側に収まる", async () => {
    // Given: 生成済みの画像。棒の行は環の外へ伸びるため除く
    const img = await load(file);
    const c = size / 2;
    const barRows = size * BAR_THICKNESS;

    // When: 棒の行の外側にある暗い画素の、中心からの最遠距離を測る
    let farthest = 0;
    for (let y = 0; y < size; y++) {
      if (Math.abs(y + 0.5 - c) <= barRows) continue;
      for (let x = 0; x < size; x++) {
        if (!isDark(px(img, x, y))) continue;
        farthest = Math.max(farthest, Math.hypot(x + 0.5 - c, y + 0.5 - c));
      }
    }

    // Then: 丸の半径との差が余裕以上
    expect(size * ADD_CIRCLE_RADIUS - farthest).toBeGreaterThanOrEqual(
      size * MIN_MARGIN,
    );
  });
});

describe("any と maskable の関係", () => {
  it.each([192, 512])(
    "同じ大きさの any と maskable が画素単位で一致する(%dpx)",
    async (size) => {
      // Given: 同じ大きさの any と maskable
      const a = await load(`../../public/icons/icon-${size}.png`);
      const m = await load(`../../public/icons/icon-${size}-maskable.png`);

      // When: 画素を比べる
      const same = a.data.equals(m.data);

      // Then: 一致する
      expect(same).toBe(true);
    },
  );
});

describe("apple-icon.png(iOS用。縮小しない)", () => {
  it("180pxで、全画素が不透明で、四隅が白で、絵柄が縮小されていない", async () => {
    // Given: apple-icon.png
    const img = await load("./apple-icon.png");
    const size = APPLE_SIZE;
    const c = Math.floor(size / 2);
    const tol = size * TOLERANCE;

    // When: 不透明・四隅・環の直径・赤い円・棒の右端を測る
    const ring = ringDiameter(img);
    const dot = runLength(size, c, (x) => px(img, x, c), isRed);

    // Then: 設計どおり(環80%、赤い円26.67%、棒が右端に接する)
    expect(img.size).toBe(size);
    expect(minAlpha(img)).toBe(255);
    for (const k of cornerColors(img)) expect(k).toEqual([255, 255, 255]);
    expect(Math.abs(ring - size * APPLE_RING_DIAMETER)).toBeLessThanOrEqual(
      tol,
    );
    expect(isRed(px(img, c, c))).toBe(true);
    expect(Math.abs(dot - size * APPLE_DOT_DIAMETER)).toBeLessThanOrEqual(tol);
    expect(isDark(px(img, size - 1, c))).toBe(true);
  });
});
