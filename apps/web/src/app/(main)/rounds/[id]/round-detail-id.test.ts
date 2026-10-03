import { describe, expect, it } from "vitest";
import { parseRoundId } from "./round-detail-id";

const ID = "123e4567-e89b-12d3-a456-426614174000";

describe("parseRoundId", () => {
  it("/rounds/<UUID>からIDを取り出す", () => {
    expect(parseRoundId(`/rounds/${ID}`)).toBe(ID);
  });

  it("末尾のスラッシュを許し、大文字のUUIDも受け付ける", () => {
    expect(parseRoundId(`/rounds/${ID}/`)).toBe(ID);
    expect(parseRoundId(`/rounds/${ID.toUpperCase()}`)).toBe(ID.toUpperCase());
  });

  it.each([
    ["プレースホルダー", "/rounds/_"],
    ["UUIDでないID", "/rounds/abc"],
    ["UUIDに余分な文字が続く", `/rounds/${ID}x`],
    ["配下のパス", `/rounds/${ID}/edit`],
    ["別のパス", `/other/${ID}`],
    ["空", ""],
  ])("%sはnullを返す", (_name, pathname) => {
    expect(parseRoundId(pathname)).toBeNull();
  });
});
