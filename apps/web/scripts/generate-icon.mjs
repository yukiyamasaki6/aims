import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";
import sharp from "sharp";

// AIMS icon — the "aim ring" design: an archery sight's ring and pin.
//
// Shape: one black region made of a ring (constant width from
// RING_START_ANGLE_DEG to SWISH_START_ANGLE_DEG) whose outer edge stays a
// plain circle of radius RING_OUTER_R all the way to the tip — only the
// inner edge moves, sweeping from RING_INNER_R out to RING_OUTER_R as a
// smoothstep-eased fraction of the sweep (no Bezier — always strictly
// between the two radii, so it can never bulge past either), which is what
// forms the tapered swish tip — plus a horizontal bar; and one red dot,
// centered on the ring's own center, marking the aim point where the
// ring's gap, the swish tip, and the bar all meet.
//
// Only a handful of numbers are actually free (see each section below);
// everything else — the ring's inner radius, and the bar's thickness,
// length, and position — is derived from them, so there's nothing left
// that could drift out of sync by hand-editing two numbers separately.
//
// Every dimension below is a plain number in a unit space centered on the
// ring, so the same shape reproduces exactly at 16px, 32px, app-icon, and
// web-header sizes.

// ==================== Parameters ====================
const FAVICON_SIZES = [16, 32, 48];
const SHAPE_CENTER = { x: 0, y: 0 };

const BLACK = "#231F20";
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
// Both radii follow DOT_RADIUS automatically: their mean is the dot's
// *diameter* scaled by the golden ratio, split symmetrically around that
// mean so the band's width (outer - inner) stays pinned to DOT_RADIUS.
const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
const RING_MEAN_R = DOT_RADIUS * 2 * GOLDEN_RATIO; // (RING_INNER_R + RING_OUTER_R) / 2
const RING_INNER_R = RING_MEAN_R - DOT_RADIUS / 2; // inner radius of the ring's constant-width band
const RING_OUTER_R = RING_MEAN_R + DOT_RADIUS / 2; // outer radius of the ring (stays circular the whole way round, including the swish)
const RING_START_ANGLE_DEG = 0; // flat inner edge of the ring, hidden under the red dot

// --- Swish (the tapered tail: same outer circle, inner edge curves out to meet it) ---
const SWISH_START_ANGLE_DEG = 180; // where the constant-width band ends and thinning begins
const SWISH_END_ANGLE_DEG = 30; // the tip — inner edge meets the outer circle here
const ARC_STEPS = 64; // sampling density per arc

// --- Horizontal bar ---
// Nothing free here — thickness, length, and position all auto-follow the
// ring and dot (computed below): the bar is exactly as thick as the ring's
// band, starts at the ring's own center, and its length is the ring's mean
// radius scaled by the golden ratio.
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

/** Eases 0..1 with zero slope at both ends, for a taper with no kink at either join. */
function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/**
 * Samples the swish's inner edge: angle interpolated linearly like any
 * other arc, but radius eased from fromR to toR as the *same* fraction of
 * that sweep — i.e. always some proportion between the inner and outer
 * radius, never a control point that could overshoot past either.
 */
function sampleTaperedArc(center, fromDeg, toDeg, fromR, toR, steps) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const deg = fromDeg + (toDeg - fromDeg) * t;
    const r = fromR + (toR - fromR) * smoothstep(t);
    points.push(polar(center, r, deg));
  }
  return points;
}

// ==================== Build the ring + swish outline ====================
const O = SHAPE_CENTER;
const swishStartAngle = clockwiseTo(RING_START_ANGLE_DEG, SWISH_START_ANGLE_DEG);
const swishEndAngle = clockwiseTo(swishStartAngle, SWISH_END_ANGLE_DEG);

const outerStart = polar(O, RING_OUTER_R, RING_START_ANGLE_DEG);
const tip = polar(O, RING_OUTER_R, swishEndAngle); // outer edge stays circular, so the tip sits on it too

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
// ...then, for the swish, eased from RING_INNER_R out to RING_OUTER_R as
// the angle sweeps from the tip back to where the constant band starts.
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
// All three follow the ring (and the dot) automatically: same width as the
// ring's band, starts at the ring's own center, and its length is the
// ring's mean radius (inner and outer averaged to 1 "unit") scaled by the
// golden ratio.
const BAR_THICKNESS = RING_OUTER_R - RING_INNER_R;
const BAR_LENGTH = RING_MEAN_R * GOLDEN_RATIO;
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

// ==================== ViewBox: square, centered on the shape's own bounds ====================
const allPoints = [
  ...outerArcPoints,
  ...innerArcPoints,
  tip,
  { x: barRightX, y: barTop },
  { x: barRightX, y: -barTop },
  { x: DOT_CENTER.x - DOT_RADIUS, y: DOT_CENTER.y },
  { x: DOT_CENTER.x + DOT_RADIUS, y: DOT_CENTER.y },
  { x: DOT_CENTER.x, y: DOT_CENTER.y - DOT_RADIUS },
  { x: DOT_CENTER.x, y: DOT_CENTER.y + DOT_RADIUS },
].map(toSvg);
const minX = Math.min(...allPoints.map((p) => p.x));
const maxX = Math.max(...allPoints.map((p) => p.x));
const minY = Math.min(...allPoints.map((p) => p.y));
const maxY = Math.max(...allPoints.map((p) => p.y));
const cx = (minX + maxX) / 2;
const cy = (minY + maxY) / 2;
const padding = 16;
const size = Math.max(maxX - minX, maxY - minY) + padding * 2;
const viewBox = { x: cx - size / 2, y: cy - size / 2, size };

// Transparent background: icon.svg/favicon.ico are browser-tab favicons
// (Next.js's app/icon.svg convention injects the same <link rel="icon">
// as favicon.ico, just for SVG-capable browsers) and blend better with
// whatever the tab's own background is. A PWA manifest's install icons,
// whenever those are generated separately, would want a fixed backing
// (e.g. "#231F20") the way this favicon doesn't.
const iconSvg = `<svg width="1024" height="1024" viewBox="${fmt(viewBox.x)} ${fmt(viewBox.y)} ${fmt(viewBox.size)} ${fmt(viewBox.size)}" xmlns="http://www.w3.org/2000/svg">
  <title>AIMS icon</title>
  <path d="${barD}" fill="${BLACK}"/>
  <path d="${ringPathD}" fill="${BLACK}"/>
  <circle cx="${fmt(dotSvgCenter.x)}" cy="${fmt(dotSvgCenter.y)}" r="${fmt(DOT_RADIUS)}" fill="${RED}"/>
</svg>
`;
const iconPath = fileURLToPath(new URL("../src/app/icon.svg", import.meta.url));
writeFileSync(iconPath, iconSvg);
console.log(`Wrote ${iconPath}`);

// ==================== favicon.ico: rasterize + pack ====================
const pngBuffers = await Promise.all(
  FAVICON_SIZES.map((faviconSize) =>
    sharp(Buffer.from(iconSvg))
      .resize(faviconSize, faviconSize)
      .png()
      .toBuffer(),
  ),
);
const ico = await pngToIco(pngBuffers);
const icoPath = fileURLToPath(new URL("../src/app/favicon.ico", import.meta.url));
writeFileSync(icoPath, ico);
console.log(`Wrote ${icoPath} (${FAVICON_SIZES.join("x, ")}x px)`);
