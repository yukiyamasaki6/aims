import { describe, expect, it } from "vitest";
import { createFakeUniqueIds } from "./fake-unique-ids-test-helpers";

describe("createFakeUniqueIds", () => {
  it("nextは`id-<n>`を1から順に返し、issuedが払い出し済みを返す", () => {
    // Given
    const { ids, issued } = createFakeUniqueIds();

    // When
    const values = [ids.next(), ids.next()];

    // Then
    expect(values).toEqual(["id-1", "id-2"]);
    expect(issued()).toEqual(["id-1", "id-2"]);
  });

  it("prefixを渡すと、その接頭辞で払い出す", () => {
    // Given
    const { ids } = createFakeUniqueIds({ prefix: "event" });

    // When
    const value = ids.next();

    // Then
    expect(value).toBe("event-1");
  });

  it("randomBytesは、既定では0埋め、渡すとその関数に従う", () => {
    // Given
    const plain = createFakeUniqueIds().ids;
    const custom = createFakeUniqueIds({
      randomBytes: (length) => new Uint8Array(length).fill(7),
    }).ids;

    // When
    const values = [plain.randomBytes(2), custom.randomBytes(2)];

    // Then
    expect(values).toEqual([new Uint8Array([0, 0]), new Uint8Array([7, 7])]);
  });

  it("issuedの戻り値を変えても、払い出し済みの記録は変わらない", () => {
    // Given
    const { ids, issued } = createFakeUniqueIds();
    ids.next();

    // When
    issued().push("other");

    // Then
    expect(issued()).toEqual(["id-1"]);
  });
});
