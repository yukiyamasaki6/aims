import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";
import sharp from "sharp";

// ==================== Parameters ====================
// All lengths are in a unit system where circle A's radius is 1.
// Classic multi-resolution favicon sizes (px).
const FAVICON_SIZES = [16, 32, 48];
const SCALE = 60;
const SHAPE_CENTER = { x: 100, y: 100 };

const YELLOW = "#FFE552";
const RED = "#F65058";
const BLUE = "#00B4E4";
// Construction-reference-only colors: one per circle, reused for that
// circle's outline, center marker, and every intersection point on it.
const CIRCLE_COLORS = {
  A: "black",
  B: "green",
  C: "blue",
  D: "purple",
  E: "orangered",
};
const FILLET_COLOR = "magenta";
// =====================================================

function dist(p, q) {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/**
 * Point on a circle (cx, cy, r) at the given angle in degrees.
 * 0 = right, 90 = up, 180 = left, 270 = down.
 */
function pointOnCircle(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

function offsetPoint(from, deg, distance) {
  return pointOnCircle(from.x, from.y, distance, deg);
}

/** Inverse of pointOnCircle. */
function angleDeg(from, to) {
  return (Math.atan2(-(to.y - from.y), to.x - from.x) * 180) / Math.PI;
}

/** The two intersection points of two circles (equal points if internally tangent). */
function circleIntersections(c1, r1, c2, r2) {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(r1 * r1 - a * a, 0));
  const mx = c1.x + (a * dx) / d;
  const my = c1.y + (a * dy) / d;
  return [
    { x: mx + (h * dy) / d, y: my - (h * dx) / d },
    { x: mx - (h * dy) / d, y: my + (h * dx) / d },
  ];
}

// ==================== ① Circle construction ====================
const A = { name: "A", center: { x: 0, y: 0 }, r: 1 };
const B = { name: "B", center: offsetPoint(A.center, 120, 1), r: 1 };
const C = { name: "C", center: B.center, r: 2 };
const D = { name: "D", center: offsetPoint(C.center, 210, 1), r: 2 };
const E = { name: "E", center: offsetPoint(D.center, 300, 1), r: 3 };
const circles = [A, B, C, D, E];

// ==================== ② Every intersection/tangency point ====================
// For each circle, the points where some other circle touches or crosses it.
const pointsOnCircle = new Map(circles.map((c) => [c.name, []]));
for (let i = 0; i < circles.length; i++) {
  for (let j = i + 1; j < circles.length; j++) {
    const c1 = circles[i];
    const c2 = circles[j];
    const d = dist(c1.center, c2.center);
    const sumR = c1.r + c2.r;
    const diffR = Math.abs(c1.r - c2.r);
    if (d > sumR + 1e-9 || d < diffR - 1e-9) continue; // no contact at all
    const [p0, p1] = circleIntersections(c1.center, c1.r, c2.center, c2.r);
    const tangent = dist(p0, p1) < 1e-6;
    pointsOnCircle.get(c1.name).push({ point: p0, with: c2.name, tangent });
    pointsOnCircle.get(c2.name).push({ point: p0, with: c1.name, tangent });
    if (!tangent) {
      pointsOnCircle.get(c1.name).push({ point: p1, with: c2.name, tangent });
      pointsOnCircle.get(c2.name).push({ point: p1, with: c1.name, tangent });
    }
  }
}

/**
 * Arc from deg1 to deg2 around (center, r). `direction` is +1 to travel by
 * increasing angle, -1 to travel by decreasing angle — this is the only
 * fact needed to walk the arc (see `spanOf`/`arcsToPathD`); there is no
 * SVG-style largeArc/sweep-flag pair to keep in sync with it.
 */
function arcFromAngles(center, r, deg1, deg2, direction) {
  return {
    cx: center.x,
    cy: center.y,
    r,
    startDeg: deg1,
    endDeg: deg2,
    direction,
  };
}

/** The signed angular distance an arc covers, walking in its own direction. */
function spanOf(arc) {
  const rawSpan = (((arc.endDeg - arc.startDeg) % 360) + 360) % 360;
  return arc.direction === 1 ? rawSpan : rawSpan - 360;
}

function reverseArc(arc) {
  return {
    ...arc,
    startDeg: arc.endDeg,
    endDeg: arc.startDeg,
    direction: -arc.direction,
  };
}

// Sort each circle's points by angle, and slice the circle into the
// primitive arcs between consecutive points — these are the only arcs
// that get used; regions are just chains of them (forward or reversed).
const arcsByCircle = new Map();
for (const c of circles) {
  const pts = pointsOnCircle
    .get(c.name)
    .map((p) => ({ ...p, deg: angleDeg(c.center, p.point) }))
    .sort((a, b) => a.deg - b.deg);
  pts.forEach((p, i) => {
    p.label = `${c.name}${i + 1}`;
  });
  const arcs = pts.map((p, i) => {
    const next = pts[(i + 1) % pts.length];
    return {
      ...arcFromAngles(c.center, c.r, p.deg, next.deg, 1),
      from: p.label,
      to: next.label,
    };
  }); // direction 1: consecutive points are already sorted by increasing angle
  arcsByCircle.set(c.name, { points: pts, arcs });
  console.error(
    `Circle ${c.name}: points [${pts.map((p) => `${p.label}=∩${p.with}${p.tangent ? "(tangent)" : ""}`).join(", ")}]`,
  );
  console.error(
    `  arcs: ${arcs.map((a) => `${c.name}-arc(${a.from}→${a.to})`).join(", ")}`,
  );
}

// ==================== ③ Named regions, as sequences like "A45", "D65432" ====================
/**
 * Splits a token like "A45" or "D65432" into consecutive point-index
 * steps, and for each step reuses the matching primitive arc already cut
 * from that circle — forward as-is, backward reversed. No new arcs.
 */
function tokenToArcs(token) {
  const circleName = token[0];
  const indices = token.slice(1).split("").map(Number);
  const { arcs, points } = arcsByCircle.get(circleName);
  const n = points.length;
  const steps = [];
  for (let i = 0; i < indices.length - 1; i++) {
    const a = indices[i];
    const b = indices[i + 1];
    if (b === (a % n) + 1) {
      steps.push(arcs[a - 1]); // forward: a → a+1
    } else if (a === (b % n) + 1) {
      steps.push(reverseArc(arcs[b - 1])); // backward: a → a-1
    } else {
      throw new Error(
        `"${token}": ${a}→${b} is not a step to a neighboring point`,
      );
    }
  }
  return steps;
}

function buildRegionArcs(tokens) {
  return tokens.flatMap(tokenToArcs);
}

/**
 * Every arc as a sampled polyline, using only pointOnCircle and each arc's
 * own signed span — no SVG path-arc command, and so no largeArc/sweep-flag
 * pair to keep consistent with the span, which had been a repeated source
 * of direction bugs in this construction.
 */
function arcsToPathD(arcs, stepsPerArc = 48) {
  const allPoints = arcs.flatMap((arc) => {
    const span = spanOf(arc);
    const points = [];
    for (let i = 0; i <= stepsPerArc; i++) {
      const deg = arc.startDeg + (span * i) / stepsPerArc;
      points.push(pointOnCircle(arc.cx, arc.cy, arc.r, deg));
    }
    return points;
  });
  const [first, ...rest] = allPoints;
  return `M ${first.x} ${first.y} ${rest.map((p) => `L ${p.x} ${p.y}`).join(" ")} Z`;
}

// D and E are internally tangent, so blue's boundary (which switches from
// following E to following D right at that tangent point) meets there at
// a cusp — a zero-angle point, not a normal corner. Blunting it means
// cutting the cusp with a small circle tangent to both D and E.
//
// Its center is pinned to the A→B axis, extended past B: on that ray, the
// line exits D and then exits E in turn (at t≈2.732 and t≈2.828), and in
// between — outside D, still inside E — sits exactly one point equidistant
// in the sense that dist(P,E)+dist(P,D) = E.r+D.r (independent of the
// fillet's own radius, since that cancels between the two tangency
// conditions). That pins down a unique center, and the radius follows.
function filletOnAxis(outerFixed, innerFixed) {
  const dir = { x: B.center.x - A.center.x, y: B.center.y - A.center.y }; // unit length: dist(A,B) = 1
  const along = (t) => ({
    x: A.center.x + dir.x * t,
    y: A.center.y + dir.y * t,
  });
  const target = outerFixed.r + innerFixed.r;
  const f = (t) =>
    dist(along(t), outerFixed.center) +
    dist(along(t), innerFixed.center) -
    target;
  let lo = 1;
  let hi = 10;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid;
    else lo = mid;
  }
  const center = along((lo + hi) / 2);
  const r = outerFixed.r - dist(center, outerFixed.center);
  const touchOuter = {
    x:
      outerFixed.center.x +
      ((center.x - outerFixed.center.x) / dist(center, outerFixed.center)) *
        outerFixed.r,
    y:
      outerFixed.center.y +
      ((center.y - outerFixed.center.y) / dist(center, outerFixed.center)) *
        outerFixed.r,
  };
  const touchInner = {
    x:
      innerFixed.center.x +
      ((center.x - innerFixed.center.x) / dist(center, innerFixed.center)) *
        innerFixed.r,
    y:
      innerFixed.center.y +
      ((center.y - innerFixed.center.y) / dist(center, innerFixed.center)) *
        innerFixed.r,
  };
  return { center, r, touchOuter, touchInner };
}
const F = filletOnAxis(E, D);

const regions = [
  { name: "blue", tokens: ["A12", "C23", "E123", "D65432"], fill: BLUE },
  { name: "red", tokens: ["A51", "D234", "B321"], fill: RED },
  { name: "yellow", tokens: ["A45", "B12"], fill: YELLOW },
];
for (const region of regions) {
  region.arcs = buildRegionArcs(region.tokens);
}
// Splice the fillet into blue's arc list — built from tokens
// ["A12","C23","E123","D65432"], so arcs[2]=E1→E2, arcs[3]=E2→E3(=D∩E),
// arcs[4]=D∩E→D5, arcs[5]=D5→D4. The fillet's touch points fall inside
// E1→E2 and D5→D4 respectively (it reaches past both C∩E and C∩D), so
// arcs[3] and arcs[4] are dropped entirely and arcs[2]/arcs[5] trimmed.
{
  const blue = regions[0];
  const arcs = blue.arcs;
  const eTrimmed = arcFromAngles(
    E.center,
    E.r,
    arcs[2].startDeg,
    angleDeg(E.center, F.touchOuter),
    arcs[2].direction,
  );
  const dTrimmed = arcFromAngles(
    D.center,
    D.r,
    angleDeg(D.center, F.touchInner),
    arcs[5].endDeg,
    arcs[5].direction,
  );
  const filletCandidates = [1, -1].map((direction) =>
    arcFromAngles(
      F.center,
      F.r,
      angleDeg(F.center, F.touchOuter),
      angleDeg(F.center, F.touchInner),
      direction,
    ),
  );
  // Of the two arcs of F between the touch points, the correct one cuts the
  // corner (bulging back toward D, away from the point the cusp used to
  // reach toward) — i.e. its midpoint is the one *farther* from that outward
  // direction, not closer to it.
  const midOf = (arc) =>
    pointOnCircle(arc.cx, arc.cy, arc.r, arc.startDeg + spanOf(arc) / 2);
  const outward = {
    x: F.center.x + (F.center.x - D.center.x) * 5,
    y: F.center.y + (F.center.y - D.center.y) * 5,
  };
  const filletArc =
    dist(midOf(filletCandidates[0]), outward) >=
    dist(midOf(filletCandidates[1]), outward)
      ? filletCandidates[0]
      : filletCandidates[1];
  blue.arcs = [
    arcs[0],
    arcs[1],
    eTrimmed,
    filletArc,
    dTrimmed,
    arcs[6],
    arcs[7],
  ];
}
for (const region of regions) {
  const loop = [...region.arcs, region.arcs[0]];
  for (let i = 0; i < loop.length - 1; i++) {
    const end = pointOnCircle(
      loop[i].cx,
      loop[i].cy,
      loop[i].r,
      loop[i].endDeg,
    );
    const nextStart = pointOnCircle(
      loop[i + 1].cx,
      loop[i + 1].cy,
      loop[i + 1].r,
      loop[i + 1].startDeg,
    );
    const gap = dist(end, nextStart);
    if (gap > 1e-6) {
      console.error(
        `WARNING: region "${region.name}" has a gap of ${gap.toFixed(4)} after arc ${i} (token boundary or within-token)`,
      );
    }
  }
}

// ==================== SVG output: circles + labeled points + labeled arc midpoints ====================
function toSvgPoint(p) {
  return { x: SHAPE_CENTER.x + p.x * SCALE, y: SHAPE_CENTER.y + p.y * SCALE };
}

function circleOutline(c) {
  const s = toSvgPoint(c.center);
  const color = CIRCLE_COLORS[c.name];
  return [
    `<circle cx="${s.x}" cy="${s.y}" r="${c.r * SCALE}" fill="none" stroke="${color}" stroke-width="1.2"/>`,
    `<circle cx="${s.x}" cy="${s.y}" r="3.5" fill="${color}"/>`,
    `<text x="${s.x - 5}" y="${s.y - 10}" font-size="16" fill="${color}" font-weight="bold">${c.name}</text>`,
  ].join("\n");
}

function dot(p, label, color, dx, dy) {
  const s = toSvgPoint(p);
  return `<circle cx="${s.x}" cy="${s.y}" r="3.5" fill="${color}"/><text x="${s.x + dx}" y="${s.y + dy}" font-size="13" fill="${color}" font-weight="bold">${label}</text>`;
}

// Group physically-coincident points (from different circles meeting at the
// same spot) so their labels can be spread apart instead of overlapping.
const allLabeledPoints = circles.flatMap((c) =>
  arcsByCircle.get(c.name).points.map((p) => ({ ...p, circleName: c.name })),
);
const clusters = [];
for (const p of allLabeledPoints) {
  const cluster = clusters.find((cl) => dist(cl.point, p.point) < 0.03);
  if (cluster) cluster.items.push(p);
  else clusters.push({ point: p.point, items: [p] });
}
const labelOffsets = [
  [8, -8],
  [8, 18],
  [-46, -8],
  [-46, 18],
  [8, 34],
  [-46, 34],
];
function toSvgArc(arc) {
  const s = toSvgPoint({ x: arc.cx, y: arc.cy });
  return { ...arc, cx: s.x, cy: s.y, r: arc.r * SCALE };
}

const parts = regions.map(
  (region) =>
    `<path d="${arcsToPathD(region.arcs.map(toSvgArc))}" fill="${region.fill}"/>`,
);
parts.push(...circles.map(circleOutline));
for (const cluster of clusters) {
  cluster.items.forEach((p, i) => {
    const [dx, dy] = labelOffsets[i % labelOffsets.length];
    parts.push(dot(p.point, p.label, CIRCLE_COLORS[p.circleName], dx, dy));
  });
}

// The A→B axis, extended well past both ends, and the fillet circle F —
// both shown for visual reference of how the tip's rounding is derived.
// F is drawn as an outline only (no fill, no solid center marker), since
// it's a construction aid, not one of the five real circles.
{
  const dir = { x: B.center.x - A.center.x, y: B.center.y - A.center.y };
  const p1 = toSvgPoint({
    x: A.center.x - dir.x * 8,
    y: A.center.y - dir.y * 8,
  });
  const p2 = toSvgPoint({
    x: A.center.x + dir.x * 8,
    y: A.center.y + dir.y * 8,
  });
  parts.push(
    `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${FILLET_COLOR}" stroke-width="1.5" stroke-dasharray="6,4"/>`,
  );
}
{
  const s = toSvgPoint(F.center);
  parts.push(
    `<circle cx="${s.x}" cy="${s.y}" r="${F.r * SCALE}" fill="none" stroke="${FILLET_COLOR}" stroke-width="1.2"/>`,
  );
  parts.push(
    `<text x="${s.x + 8}" y="${s.y - 8}" font-size="13" fill="${FILLET_COLOR}" font-weight="bold">F</text>`,
  );
}

// A square viewBox that contains every circle.
const minX = Math.min(
  ...circles.map((c) => toSvgPoint(c.center).x - c.r * SCALE),
);
const maxX = Math.max(
  ...circles.map((c) => toSvgPoint(c.center).x + c.r * SCALE),
);
const minY = Math.min(
  ...circles.map((c) => toSvgPoint(c.center).y - c.r * SCALE),
);
const maxY = Math.max(
  ...circles.map((c) => toSvgPoint(c.center).y + c.r * SCALE),
);
const padding = 20;
const size = Math.max(maxX - minX, maxY - minY) + padding * 2;
const cx = (minX + maxX) / 2;
const cy = (minY + maxY) / 2;
const viewBox = { x: cx - size / 2, y: cy - size / 2, size };

const debugSvg = `<svg width="900" height="900" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.size} ${viewBox.size}" xmlns="http://www.w3.org/2000/svg"><title>AIMS icon construction reference</title><rect x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.size}" height="${viewBox.size}" fill="white"/>${parts.join("\n")}</svg>`;
const debugPath = fileURLToPath(
  new URL("./construction-reference.svg", import.meta.url),
);
writeFileSync(debugPath, debugSvg);
console.log(`Wrote ${debugPath}`);

// A square viewBox centered on the finished shapes' own bounding box (so
// padding is even on all four sides), sized so they still fit entirely
// within the circle inscribed in that square (the maskable safe area).
const iconPadding = 5;
const regionPoints = regions.flatMap((region) =>
  region.arcs.flatMap((arc) => {
    const span = spanOf(arc);
    return Array.from({ length: 17 }, (_, i) => i / 16).map((t) =>
      toSvgPoint(pointOnCircle(arc.cx, arc.cy, arc.r, arc.startDeg + span * t)),
    );
  }),
);
const center = {
  x:
    (Math.min(...regionPoints.map((p) => p.x)) +
      Math.max(...regionPoints.map((p) => p.x))) /
    2,
  y:
    (Math.min(...regionPoints.map((p) => p.y)) +
      Math.max(...regionPoints.map((p) => p.y))) /
    2,
};
const radius = Math.max(...regionPoints.map((p) => dist(p, center)));
const iconSize = (radius + iconPadding) * 2;
const iconViewBox = {
  x: center.x - iconSize / 2,
  y: center.y - iconSize / 2,
  size: iconSize,
};

// Transparent background: icon.svg/favicon.ico are browser-tab favicons
// (Next.js's app/icon.svg convention injects the same <link rel="icon">
// as favicon.ico, just for SVG-capable browsers) and blend better with
// whatever the tab's own background is. A PWA manifest's install icons,
// whenever those are generated separately, would want a fixed backing
// (e.g. "#231F20") the way this favicon doesn't.
const iconParts = regions.map(
  (region) =>
    `  <path d="${arcsToPathD(region.arcs.map(toSvgArc))}" fill="${region.fill}"/>`,
);
const iconSvg = `<svg width="1024" height="1024" viewBox="${iconViewBox.x} ${iconViewBox.y} ${iconViewBox.size} ${iconViewBox.size}" xmlns="http://www.w3.org/2000/svg">\n  <title>AIMS icon</title>\n${iconParts.join("\n")}\n</svg>\n`;
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
const icoPath = fileURLToPath(
  new URL("../src/app/favicon.ico", import.meta.url),
);
writeFileSync(icoPath, ico);
console.log(`Wrote ${icoPath} (${FAVICON_SIZES.join("x, ")}x px)`);
