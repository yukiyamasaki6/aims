import { describe, expect, it } from "vitest";
import {
  originPathOf,
  roundFramePathOf,
  roundIdOfPath,
  roundOriginOf,
} from "@/features/rounds/domain/round-routes";
import { FRAME_PATHS, ROUND_FRAME_PATH } from "@/routes";

const ID = "123e4567-e89b-12d3-a456-426614174000";

describe("roundIdOfPath", () => {
  it("/rounds/<UUID>からIDを取り出す", () => {
    // Given

    // When
    const id = roundIdOfPath(`/rounds/${ID}`);

    // Then
    expect(id).toBe(ID);
  });

  it("大文字のUUIDも受け付ける", () => {
    // Given

    // When
    const id = roundIdOfPath(`/rounds/${ID.toUpperCase()}`);

    // Then
    expect(id).toBe(ID.toUpperCase());
  });

  it.each([
    ["プレースホルダー", "/rounds/_"],
    ["UUIDでないID", "/rounds/abc"],
    ["UUIDに余分な文字が続く", `/rounds/${ID}x`],
    ["配下のパス", `/rounds/${ID}/edit`],
    ["別のパス", `/other/${ID}`],
    ["空", ""],
  ])("%sはnullを返す", (_name, pathname) => {
    // Given

    // When
    const id = roundIdOfPath(pathname);

    // Then
    expect(id).toBeNull();
  });
});

describe("roundFramePathOf", () => {
  it.each([
    ["/rounds", "/rounds"],
    ["/rounds/history", "/rounds/history"],
    ["/rounds/new", "/rounds/new"],
    ["/rounds/6f1c2f3e-0000-4000-8000-000000000000", "/rounds/_"],
    ["/rounds/abc", "/rounds/_"],
    ["/rounds/_", "/rounds/_"],
  ])("%sに対応する枠の経路は%sである", (pathname, expected) => {
    // Given
    // When
    const framePath = roundFramePathOf(pathname);

    // Then
    expect(framePath).toBe(expected);
  });

  it.each([
    "/",
    "/signin",
    "/offline",
    "/rounds/",
    "/rounds/abc/x",
    "/rounds/new/x",
    "/roundsx",
    "/__shell/rounds",
    "/settings",
    "/settings/x",
  ])("%sは枠がない", (pathname) => {
    // Given
    // When
    const framePath = roundFramePathOf(pathname);

    // Then
    expect(framePath).toBeNull();
  });

  it("newは任意IDの枠にならない", () => {
    // Given
    // When
    const framePath = roundFramePathOf("/rounds/new");

    // Then
    expect(framePath).not.toBe(ROUND_FRAME_PATH);
  });

  it("返す枠の経路は、全てFRAME_PATHSに含まれる", () => {
    // Given
    const pathnames = [
      "/rounds",
      "/rounds/history",
      "/rounds/new",
      "/rounds/x",
    ];

    // When
    const frames = pathnames.map(roundFramePathOf);

    // Then
    for (const frame of frames) expect(FRAME_PATHS).toContain(frame);
  });
});

describe("roundOriginOf", () => {
  it.each([
    ["from=historyだけ", "?from=history"],
    ["他のクエリと並ぶfrom=history", "?a=1&from=history"],
  ])("%sは履歴を返す", (_name, search) => {
    // Given

    // When
    const origin = roundOriginOf(search);

    // Then
    expect(origin).toBe("history");
  });

  it.each([
    ["クエリがない", ""],
    ["fromがない", "?a=1"],
    ["未知の値", "?from=other"],
    ["home", "?from=home"],
    ["空の値", "?from="],
    ["大文字小文字が違う値", "?from=History"],
    ["同じ値の重複", "?from=history&from=history"],
    ["異なる値の重複", "?from=history&from=home"],
  ])("%sはホームを返す", (_name, search) => {
    // Given

    // When
    const origin = roundOriginOf(search);

    // Then
    expect(origin).toBe("home");
  });
});

describe("originPathOf", () => {
  it.each([
    ["home", "/rounds"],
    ["history", "/rounds/history"],
  ] as const)("遷移元%sの戻り先は%sである", (origin, expected) => {
    // Given

    // When
    const path = originPathOf(origin);

    // Then
    expect(path).toBe(expected);
  });
});
