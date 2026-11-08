import { describe, expect, it } from "vitest";
import {
  roundFramePathOf,
  roundIdOfPath,
} from "@/features/rounds/domain/round-routes";
import { ROUND_FRAME_PATH, ROUND_FRAME_PATHS } from "@/routes";

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

  it("返す枠の経路は、全てROUND_FRAME_PATHSに含まれる", () => {
    // Given
    const pathnames = ["/rounds", "/rounds/new", "/rounds/x"];

    // When
    const frames = pathnames.map(roundFramePathOf);

    // Then
    for (const frame of frames) expect(ROUND_FRAME_PATHS).toContain(frame);
  });
});
