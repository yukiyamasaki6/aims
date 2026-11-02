import { describe, expect, it } from "vitest";
import { roundIdOfPath } from "@/features/rounds/domain/round-routes";

const ID = "123e4567-e89b-12d3-a456-426614174000";

describe("roundIdOfPath", () => {
  it("/rounds/<UUID>からIDを取り出す", () => {
    // Given

    // When
    const id = roundIdOfPath(`/rounds/${ID}`);

    // Then
    expect(id).toBe(ID);
  });

  it("末尾のスラッシュを許す", () => {
    // Given

    // When
    const id = roundIdOfPath(`/rounds/${ID}/`);

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
