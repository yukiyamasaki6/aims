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

  it.each([1, 10, 16])(
    "randomBytes(%i)は、その長さのバイト列を返す",
    (length) => {
      // Given
      const ids = createBrowserUniqueIds();

      // When
      const bytes = ids.randomBytes(length);

      // Then
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes).toHaveLength(length);
    },
  );

  it("randomBytesは、呼ぶたびに異なる値を返す", () => {
    // Given
    const ids = createBrowserUniqueIds();

    // When
    const first = ids.randomBytes(10);
    const second = ids.randomBytes(10);

    // Then
    expect(Array.from(second)).not.toEqual(Array.from(first));
  });

  it("生成の時点では乱数のバイト列に触れず、randomBytesで初めて触れる", () => {
    // Given
    const getRandomValues = vi.spyOn(crypto, "getRandomValues");

    // When
    const ids = createBrowserUniqueIds();
    const touchedByCreate = getRandomValues.mock.calls.length;
    ids.randomBytes(10);

    // Then
    expect(touchedByCreate).toBe(0);
    expect(getRandomValues).toHaveBeenCalled();
  });
});
