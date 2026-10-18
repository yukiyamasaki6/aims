import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import pngToIco from "png-to-ico";
import sharp from "sharp";

// AIMS icon — the "aim ring" design: an archery sight's ring and pin.
//
// Shape: one mark region made of a ring (constant width from
// RING_START_ANGLE_DEG to SWISH_START_ANGLE_DEG) whose outer edge stays a
// plain circle of radius RING_OUTER_R all the way to the tip — only the
// inner edge moves. The lower half keeps a constant width; the inner edge
// starts closing in at the ring's left end and, over the upper half, sweeps
// from RING_INNER_R out to RING_OUTER_R as the square of the fraction of the
// sweep (no Bezier — always strictly between the two radii, so it can never
// bulge past either), which forms the tapered swish tip — plus a horizontal
// bar; and one red dot, centered on the ring's own center, marking the aim
// point near where the swish tip and the bar meet.
//
// Only DOT_RADIUS is free (see each section below); everything else is
// derived from it, so there's nothing left that could drift out of sync by
// hand-editing two numbers separately. Measured from the center, the dot,
// the gap, and the ring's band are three equal widths (outer : inner : dot
// = 3 : 2 : 1), and the ring's outer edge is 80% of the icon's half-width;
// the bar runs to the icon's right edge (100%). (icon.svgの場合。manifestのアイコン
// (any/maskable)はINSTALL_ART_SCALEで絵柄全体を縮める。apple-iconは縮めない。)
//
// public/logo.svg（文字付きロゴ）も同じ値から生成する。マークの右に、Geist Sans
// のBoldの字形を図形にした「AIMS」を並べた横組みで、白い丸角の地を持つ。
//
// Every dimension below is a plain number in a unit space centered on the
// ring, so the same shape reproduces exactly at 16px, 32px, app-icon, and
// web-header sizes.

// ==================== Parameters ====================
const FAVICON_SIZES = [16, 32, 48];
const SHAPE_CENTER = { x: 0, y: 0 };

const BLACK = "#231F20";
const WHITE = "#FFFFFF";
const RED = "#E4402C";

// Angles: degrees, 0 = right, 90 = up, 180 = left, increasing
// counter-clockwise. Give them as plain canonical values (0-360) —
// clockwiseTo() below takes care of turning a "start -> end" pair into a
// continuously decreasing sweep, so wraparound is never something a
// parameter has to account for.
function clockwiseTo(fromDeg, toDegCanonical) {
  let target = toDegCanonical;
  while (target >= fromDeg) target -= 360;
  return target;
}

// --- Aim dot (red) ---
// Centered on the ring's own center (the origin) — the same point the bar
// extends from.
const DOT_CENTER = SHAPE_CENTER;
const DOT_RADIUS = 27; // 中央の点のサイズ

// --- Ring ---
// From the center, the dot, the gap, and the ring's band are equal widths
// of DOT_RADIUS each, so the band's width (outer - inner) equals DOT_RADIUS.
const RING_INNER_R = DOT_RADIUS * 2; // inner radius of the ring's constant-width band
const RING_OUTER_R = DOT_RADIUS * 3; // outer radius of the ring (stays circular the whole way round, including the swish)
const BAND = RING_OUTER_R - RING_INNER_R;
const RING_START_ANGLE_DEG = 0; // flat inner edge of the ring, hidden under the red dot

// --- Swish (the tapered tail: same outer circle, inner edge curves out to meet it) ---
const SWISH_START_ANGLE_DEG = 180; // where the constant-width band ends and thinning begins
// The tip — inner edge meets the outer circle here. It sits where the arc
// along the outer edge from the bar's top edge to the tip is 1.5 times the
// band's width (independent of DOT_RADIUS).
const BAR_THICKNESS = BAND;
const BAR_TOP_ANGLE_DEG =
  (Math.asin(BAR_THICKNESS / 2 / RING_OUTER_R) * 180) / Math.PI;
const SWISH_END_ANGLE_DEG =
  BAR_TOP_ANGLE_DEG + (((1.5 * BAND) / RING_OUTER_R) * 180) / Math.PI;
const ARC_STEPS = 64; // sampling density per arc

// --- Horizontal bar ---
// Nothing free here — thickness, length, and position all auto-follow the
// ring and dot: the bar is exactly as thick as the ring's band, starts at
// the ring's own center, and runs to the icon's right edge, which puts the
// ring's outer edge at 80% of the half-width.
const RING_OUTER_TO_HALF = 0.8;
const BAR_LENGTH = RING_OUTER_R / RING_OUTER_TO_HALF;

// --- Install icons (manifest any/maskable) ---
// インストール用の絵柄の縮小率。絵柄全体(環、赤い円、棒の太さ、棒の長さ)を、
// 中心を基準に元の比率のまま縮める。
// 環の外縁は半幅の80%なので、環の直径は画像の幅の 0.8 * 61/80 = 61% になる。
// 表示は2経路ある。
// (1) 余白のある経路(インストールしたホーム画面、アプリの一覧): AndroidのChromeが
//     maskableに透明の余白を足して約1.309倍のキャンバスにするため、画像の中央87.3%が
//     表示され、環は枠の約70%に見える。
// (2) 余白のない経路(「ホーム画面に追加」の丸、ショートカット): 画像の中央66.7%
//     (実測67から70%)が丸に表示され、環は枠の約87から91%に見える。
//     棒の先がこの経路で切れることは認めるが、環の外に棒が出て見える長さは
//     画像の幅の2.9%(丸66.7%。棒の太さの0.28倍、丸110pxで約4.8px)あり、
//     この経路が環の直径の上限を決める。
// 理想(環が枠の80%)は2経路で同時に成り立たない(同じ画像が約1.31倍違って見える)。
// apple-iconには適用しない(iOSは画像の全体を表示するため、縮小すると環が枠の
// 約61%になる。ユーザーの指示でiOSは縮小しない)。
const INSTALL_ART_SCALE = 61 / 80;

// --- Logo with text (public/logo.svg) ---
const LOGO_TEXT = "AIMS"; // ロゴの文字
const LOGO_CAP_HEIGHT = RING_INNER_R + RING_OUTER_R; // 文字の大文字の高さ(環の内径と外径の中間。DOT_RADIUSの5倍)
const LOGO_EDGE_PAD = RING_OUTER_R / RING_OUTER_TO_HALF - RING_OUTER_R; // 地の縁から絵柄までの余白(左端の地の縁から環までと同じ。右端は文字の輪郭に対して同じ余白を取る)
const TEXT_GAP = LOGO_EDGE_PAD; // 棒の右端から文字の左端までの間隔(地の縁から絵柄までの余白と同じ)
const LETTER_SPACING_EM = 0; // 字間の追加(フォントサイズに対する比。カーニングに足す)
// =====================================================

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function unitVec(deg) {
  const r = toRad(deg);
  return { x: Math.cos(r), y: Math.sin(r) };
}

function addV(p, v) {
  return { x: p.x + v.x, y: p.y + v.y };
}

function scaleV(v, s) {
  return { x: v.x * s, y: v.y * s };
}

/** Point on a circle at the given angle (logical, y-up space). */
function polar(center, r, deg) {
  return addV(center, scaleV(unitVec(deg), r));
}

/** Samples an arc as logical-space points, angle interpolated linearly (raw degrees, never wrapped). */
function sampleArc(center, r, fromDeg, toDeg, steps) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const deg = fromDeg + ((toDeg - fromDeg) * i) / steps;
    points.push(polar(center, r, deg));
  }
  return points;
}

/**
 * Samples the swish's inner edge: angle interpolated linearly like any
 * other arc, but radius moved from fromR to toR as the *square* of the
 * fraction of that sweep measured from the thin tip's far end (so it closes
 * in slowly at first and faster toward the tip) — i.e. always some proportion between the inner and outer
 * radius, never a control point that could overshoot past either.
 */
function sampleTaperedArc(center, fromDeg, toDeg, fromR, toR, steps) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const deg = fromDeg + (toDeg - fromDeg) * t;
    const r = fromR + (toR - fromR) * (1 - (1 - t) * (1 - t));
    points.push(polar(center, r, deg));
  }
  return points;
}

// ==================== Build the ring + swish outline ====================
const O = SHAPE_CENTER;
const swishStartAngle = clockwiseTo(
  RING_START_ANGLE_DEG,
  SWISH_START_ANGLE_DEG,
);
const swishEndAngle = clockwiseTo(swishStartAngle, SWISH_END_ANGLE_DEG);

const outerStart = polar(O, RING_OUTER_R, RING_START_ANGLE_DEG);

// Outer edge: one continuous circle arc from the flat start all the way to
// the tip — the swish never leaves this circle.
const outerArcPoints = sampleArc(
  O,
  RING_OUTER_R,
  RING_START_ANGLE_DEG,
  swishEndAngle,
  ARC_STEPS,
);
// Inner edge: constant radius for the ring's body...
const innerArcPoints = sampleArc(
  O,
  RING_INNER_R,
  swishStartAngle,
  RING_START_ANGLE_DEG,
  ARC_STEPS,
);
// ...then, for the swish, RING_INNER_R moves out to RING_OUTER_R with the
// square of the sweep fraction, from where the constant band ends to the tip.
const swishInnerPoints = sampleTaperedArc(
  O,
  swishEndAngle,
  swishStartAngle,
  RING_OUTER_R,
  RING_INNER_R,
  ARC_STEPS,
);

function toSvg(p) {
  return { x: SHAPE_CENTER.x + p.x, y: SHAPE_CENTER.y - p.y };
}

function fmt(n) {
  return Number(n.toFixed(3));
}

function svgPt(p) {
  const s = toSvg(p);
  return `${fmt(s.x)} ${fmt(s.y)}`;
}

const ringPathD = [
  `M ${svgPt(outerStart)}`,
  ...outerArcPoints.slice(1).map((p) => `L ${svgPt(p)}`),
  ...swishInnerPoints.slice(1).map((p) => `L ${svgPt(p)}`),
  ...innerArcPoints.slice(1).map((p) => `L ${svgPt(p)}`),
  `L ${svgPt(outerStart)}`,
  "Z",
].join(" ");

// ==================== Bar + dot ====================
// BAR_THICKNESS and BAR_LENGTH are defined with the parameters above.
const barLeftX = SHAPE_CENTER.x;
const barRightX = SHAPE_CENTER.x + BAR_LENGTH;
const barTop = BAR_THICKNESS / 2;
const barD = [
  `M ${svgPt({ x: barLeftX, y: barTop })}`,
  `L ${svgPt({ x: barRightX, y: barTop })}`,
  `L ${svgPt({ x: barRightX, y: -barTop })}`,
  `L ${svgPt({ x: barLeftX, y: -barTop })}`,
  "Z",
].join(" ");

const dotSvgCenter = toSvg(DOT_CENTER);

// ==================== ViewBox: square, red dot at the center, bar tip on the right edge ====================
// The dot sits at the origin, so a square of half-width BAR_LENGTH (the
// bar's right end) puts the dot at the icon's center and the bar's tip on
// the right edge. The ring (80% of the half-width) stays well inside.
const half = BAR_LENGTH;
const viewBox = { x: -half, y: -half, size: half * 2 };
// 全アイコンは白地・黒の絵柄に統一し、明暗の切り替えはしない。
// タブ用(icon.svg、favicon.ico)は、正方形に内接する丸の白地で、丸の外は透明。
// このとき棒の右端は、丸の縁に沿った弧にする(直線の端のままだと、角が丸の外へ
// はみ出す)。PWAは白の四角の地で、棒の右端は直線のまま(正方形の縁に接する)。
// scale は plate が "none" のときだけ使う。viewBoxを1/scale倍に広げ、絵柄全体を
// 中心を基準に元の比率のまま縮める。1のとき縮小しない。
function markElements({ circleBar }) {
  const t = BAR_THICKNESS / 2;
  const xc = Math.sqrt(half * half - t * t);
  const bar = circleBar
    ? `M ${fmt(barLeftX)} ${fmt(-t)} L ${fmt(xc)} ${fmt(-t)} A ${fmt(half)} ${fmt(half)} 0 0 1 ${fmt(xc)} ${fmt(t)} L ${fmt(barLeftX)} ${fmt(t)} Z`
    : barD;
  return `<path d="${bar}" fill="${BLACK}"/>
  <path d="${ringPathD}" fill="${BLACK}"/>
  <circle cx="${fmt(dotSvgCenter.x)}" cy="${fmt(dotSvgCenter.y)}" r="${fmt(DOT_RADIUS)}" fill="${RED}"/>`;
}

function buildSvg({ plate, scale = 1 }) {
  const circle = plate === "circle";
  const span = circle ? viewBox.size : viewBox.size / scale;
  const plateShape = circle
    ? `\n  <circle cx="0" cy="0" r="${fmt(half)}" fill="${WHITE}"/>`
    : "";
  const title = circle ? "\n  <title>AIMS icon</title>" : "";
  return `<svg width="1024" height="1024" viewBox="${fmt(-span / 2)} ${fmt(-span / 2)} ${fmt(span)} ${fmt(span)}" xmlns="http://www.w3.org/2000/svg">${title}${plateShape}
  ${markElements({ circleBar: circle })}
</svg>
`;
}

// ==================== Logo with text ====================
// 「AIMS」をGeist SansのBold(アプリのfont-boldと同じ太さ)の字形から図形にする。
// 文字は大文字の高さの中央を環の中心(y=0)にそろえ、字形の左端を棒の右端から
// TEXT_GAPだけ離す。フォントの参照は残さない。
function loadFont() {
  const fontUrl = new URL(
    "./fonts/geist-sans/Geist-Bold.ttf",
    import.meta.resolve("geist/font/sans"),
  );
  const data = readFileSync(fileURLToPath(fontUrl));
  return opentype.parse(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  );
}

function layoutGlyphs(font, startX, fontSize, baselineY) {
  const scale = fontSize / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(LOGO_TEXT);
  const paths = [];
  let x = startX;
  glyphs.forEach((glyph, i) => {
    paths.push(glyph.getPath(x, baselineY, fontSize));
    const next = glyphs[i + 1];
    const kerning = next ? font.getKerningValue(glyph, next) * scale : 0;
    x += glyph.advanceWidth * scale + kerning + LETTER_SPACING_EM * fontSize;
  });
  return paths;
}

// 2次曲線を折れ線の点に直す。
function sampleQuad(prev, c) {
  const points = [];
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    const u = 1 - t;
    points.push({
      x: u * u * prev.x + 2 * u * t * c.x1 + t * t * c.x,
      y: u * u * prev.y + 2 * u * t * c.y1 + t * t * c.y,
    });
  }
  return points;
}

// 字形の輪郭の点(曲線は折れ線に直す)。
function outlinePoints(paths) {
  const points = [];
  for (const path of paths) {
    let prev = { x: 0, y: 0 };
    for (const c of path.commands) {
      if (c.type === "Q") points.push(...sampleQuad(prev, c));
      else if (c.type !== "Z") points.push({ x: c.x, y: c.y });
      if (c.type !== "Z") prev = { x: c.x, y: c.y };
    }
  }
  return points;
}

// 右端の半円の中心。左端と同じく、地の縁から絵柄まで LOGO_EDGE_PAD を保つため、
// 文字の輪郭がすべて、この中心から半径 half - LOGO_EDGE_PAD の円の内側に入る位置にする。
function plateEndCenterX(paths) {
  const r = half - LOGO_EDGE_PAD;
  return Math.max(
    ...outlinePoints(paths).map((pt) => pt.x - Math.sqrt(r * r - pt.y * pt.y)),
  );
}

function buildTextPath() {
  const font = loadFont();
  const fontSize =
    (LOGO_CAP_HEIGHT * font.unitsPerEm) / font.tables.os2.sCapHeight;
  const baselineY = LOGO_CAP_HEIGHT / 2;
  const measured = layoutGlyphs(font, 0, fontSize, baselineY);
  const left = Math.min(...measured.map((p) => p.getBoundingBox().x1));
  const paths = layoutGlyphs(font, half + TEXT_GAP - left, fontSize, baselineY);
  const d = paths.map((p) => p.toPathData(3)).join(" ");
  return { d, endCenterX: plateEndCenterX(paths) };
}

function buildLogoSvg() {
  const { d, endCenterX } = buildTextPath();
  const width = endCenterX + half + half;
  const height = half * 2;
  const w = fmt(width);
  const h = fmt(height);
  return {
    width: w,
    height: h,
    svg: `<svg width="${w}" height="${h}" viewBox="${fmt(-half)} ${fmt(-half)} ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <title>AIMS logo</title>
  <rect x="${fmt(-half)}" y="${fmt(-half)}" width="${w}" height="${h}" rx="${fmt(half)}" ry="${fmt(half)}" fill="${WHITE}"/>
  ${markElements({ circleBar: true })}
  <path d="${d}" fill="${BLACK}"/>
</svg>
`,
  };
}

const iconSvg = buildSvg({ plate: "circle" });
const iconPath = fileURLToPath(new URL("../src/app/icon.svg", import.meta.url));
writeFileSync(iconPath, iconSvg);
console.log(`Wrote ${iconPath}`);

const logo = buildLogoSvg();
const logoPath = fileURLToPath(new URL("../public/logo.svg", import.meta.url));
writeFileSync(logoPath, logo.svg);
console.log(`Wrote ${logoPath} (viewBox ${logo.width} x ${logo.height})`);

// ==================== favicon.ico: rasterize + pack ====================
const pngBuffers = await Promise.all(
  FAVICON_SIZES.map((faviconSize) =>
    sharp(Buffer.from(buildSvg({ plate: "circle" })))
      .resize(faviconSize, faviconSize)
      .png()
      .toBuffer(),
  ),
);
const ico = await pngToIco(pngBuffers);
const icoPath = fileURLToPath(
  new URL("../src/app/favicon.ico", import.meta.url),
);
writeFileSync(icoPath, ico);
console.log(`Wrote ${icoPath} (${FAVICON_SIZES.join("x, ")}x px)`);

// ==================== Manifest install icons: solid white background ====================
// PWAインストールアイコンは、白の四角の地に黒の絵柄を描き込む。
// any と maskable は同じ画像。絵柄全体をINSTALL_ART_SCALE倍に縮める。
// 余白のない経路の丸では棒の先が欠ける(認める)。
const MANIFEST_ICON_SIZES = [192, 512];

async function renderIcon(size, scale) {
  const content = await sharp(Buffer.from(buildSvg({ plate: "none", scale })))
    .resize(size, size)
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: WHITE },
  })
    .composite([{ input: content, gravity: "center" }])
    .png()
    .toBuffer();
}

const iconsDir = fileURLToPath(new URL("../public/icons", import.meta.url));
mkdirSync(iconsDir, { recursive: true });

for (const size of MANIFEST_ICON_SIZES) {
  const standardIcon = await renderIcon(size, INSTALL_ART_SCALE);
  const standardPath = fileURLToPath(
    new URL(`../public/icons/icon-${size}.png`, import.meta.url),
  );
  writeFileSync(standardPath, standardIcon);
  console.log(`Wrote ${standardPath}`);

  const maskableIcon = await renderIcon(size, INSTALL_ART_SCALE);
  const maskablePath = fileURLToPath(
    new URL(`../public/icons/icon-${size}-maskable.png`, import.meta.url),
  );
  writeFileSync(maskablePath, maskableIcon);
  console.log(`Wrote ${maskablePath}`);
}

// ==================== iOSホーム画面用アイコン ====================
// 透明だとiOSが黒で塗るため、不透明の白地にする。角はiOSが丸めるため丸めない。
// maskableの区別はない。縮小しない(scale=1)。環は枠の80%に見える。
// src/app/apple-icon.png はNext.jsのファイル規約で
// apple-touch-icon のlinkとして全ページに出力される。
const APPLE_ICON_SIZE = 180;
const applePath = fileURLToPath(
  new URL("../src/app/apple-icon.png", import.meta.url),
);
writeFileSync(applePath, await renderIcon(APPLE_ICON_SIZE, 1));
console.log(`Wrote ${applePath}`);
