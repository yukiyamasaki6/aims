import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FIELD_COLORS, FIELD_EDGES } from "./field-target";
import { STANDARD_COLORS } from "./standard-target";
import { RINGS } from "./target-mark";
import { TRIPLE_RADIUS, TRIPLE_SPOTS } from "./target-triple";

// 図の的は、簡略化した描き方(輪の枚数・境界線・形)で、色と、色ごとの外縁の半径の比だけが、アプリの的の定義(target_face_rings)と同じである。ここでは、その色と、色ごとの外縁の比だけを、SQLと比べる。簡略化した構造は、比べない。
const SQL = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20261016000100_target_faces.sql",
  ),
  "utf8",
);

type Ring = {
  radius: number;
  color: string;
  line: string | null;
  scoreStr: string;
};

function faceId(name: string): string {
  const match = new RegExp(`\\('(a1000000-[0-9a-f-]+)', NULL, '${name}'`).exec(
    SQL,
  );
  if (!match) throw new Error(`的が見つからない: ${name}`);
  return match[1];
}

function spotsOf(id: string): { id: string; x: number; y: number }[] {
  const rows = [
    ...SQL.matchAll(
      /\('(a2000000-[0-9a-f-]+)', '(a1000000-[0-9a-f-]+)', ([-0-9.]+), ([-0-9.]+),/g,
    ),
  ];
  return rows
    .filter((m) => m[2] === id)
    .map((m) => ({ id: m[1], x: Number(m[3]), y: Number(m[4]) }));
}

function ringsOf(spotId: string): Ring[] {
  const rows = [
    ...SQL.matchAll(
      /\('[0-9a-f-]+', '(a2000000-[0-9a-f-]+)', ([0-9.]+), '(#[0-9A-F]+)', (NULL|'#[0-9A-F]+'), \d+, '(\w+)', \d+,/g,
    ),
  ];
  return rows
    .filter((m) => m[1] === spotId)
    .map((m) => ({
      radius: Number(m[2]),
      color: m[3],
      line: m[4] === "NULL" ? null : m[4].slice(1, -1),
      scoreStr: m[5],
    }))
    .sort((a, b) => b.radius - a.radius);
}

function firstSpotRings(name: string): Ring[] {
  return ringsOf(spotsOf(faceId(name))[0].id);
}

// 色ごとの外縁の半径の比(その色のリングの最大半径 / 的の半径)
function edgeOf(rings: Ring[], color: string): number {
  return (
    Math.max(...rings.filter((r) => r.color === color).map((r) => r.radius)) /
    rings[0].radius
  );
}

describe("図の的の色と、色ごとの外縁の比は、アプリの的の定義と同じ", () => {
  it("標準の的は、10点的の色ごとの外縁が、内側から0.2ずつである", () => {
    const rings = firstSpotRings("10点的（アウトドア・122cm）");
    STANDARD_COLORS.forEach((color, i) => {
      expect(edgeOf(rings, color)).toBeCloseTo((i + 1) / 5, 12);
    });
  });

  it.each([
    ["six", "6点的（アウトドア・80cm）"],
    ["spot3", "6点的（インドア・60cm・3つ目トライアングル）"],
  ] as const)(
    "%sの色と色ごとの外縁の比は、アプリの「%s」と同じ",
    (variant, name) => {
      const rings = firstSpotRings(name);
      for (const [color, radius] of RINGS[variant]) {
        expect(radius / 50).toBeCloseTo(edgeOf(rings, color), 12);
      }
    },
  );

  it("フィールド的の黄・黒の色と外縁の比は、アプリの「フィールド的（60cm）」と同じ", () => {
    const rings = firstSpotRings("フィールド的（60cm）");
    expect(FIELD_COLORS.yellow).toBe("#FFE552");
    expect(FIELD_EDGES.yellow).toBeCloseTo(
      edgeOf(rings, FIELD_COLORS.yellow),
      12,
    );
    expect(FIELD_EDGES.black).toBeCloseTo(
      edgeOf(rings, FIELD_COLORS.black),
      12,
    );
  });
});

describe("三つ目の配置は、アプリの的の定義と同じ", () => {
  const name = "6点的（インドア・60cm・3つ目トライアングル）";
  const spots = spotsOf(faceId(name));
  // アプリは上向きがプラス、図は下向きがプラス。
  const sql = spots.map((spot) => ({
    x: spot.x,
    y: -spot.y,
    radius: ringsOf(spot.id)[0].radius,
  }));

  it("3つの的の半径は、すべて同じで、図の定数と同じである", () => {
    expect(sql.map((s) => s.radius)).toEqual([15, 15, 15]);
    expect(TRIPLE_RADIUS).toBe(15);
  });

  it("3つの的の中心の、半径に対する相対位置は、図の定数と同じである", () => {
    expect(TRIPLE_SPOTS.length).toBe(sql.length);
    TRIPLE_SPOTS.forEach((spot, i) => {
      expect(spot.x / TRIPLE_RADIUS).toBeCloseTo(sql[i].x / sql[i].radius, 12);
      expect(spot.y / TRIPLE_RADIUS).toBeCloseTo(sql[i].y / sql[i].radius, 12);
    });
  });
});
