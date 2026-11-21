import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserUniqueIds } from "./browser-unique-ids";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createBrowserUniqueIds", () => {
  it("next()は呼ぶたびに異なる、UUIDの形の文字列を返す", () => {
    // Given
    const ids = createBrowserUniqueIds();

    // When
    const first = ids.next();
    const second = ids.next();

    // Then
    expect(first).toMatch(UUID);
    expect(second).toMatch(UUID);
    expect(second).not.toBe(first);
  });

  it("生成の時点では実行環境の乱数に触れず、next()で初めて触れる", () => {
    // Given
    const randomUuid = vi.spyOn(crypto, "randomUUID");

    // When
    const ids = createBrowserUniqueIds();
    const touchedByCreate = randomUuid.mock.calls.length;
    ids.next();

    // Then
    expect(touchedByCreate).toBe(0);
    expect(randomUuid).toHaveBeenCalled();
  });
});
