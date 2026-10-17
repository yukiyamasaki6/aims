import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROUND_PRESET_SELECT } from "./reference-query-constants";
import {
  loadReferenceSnapshot,
  saveReferenceSnapshot,
  updateReferenceSnapshot,
} from "./reference-snapshot";

const IDENTITY_KEY = "aims:local-user-id";

beforeEach(() => {
  localStorage.setItem(IDENTITY_KEY, "user-1");
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// 端末の識別によらず、ユーザーのキーに保存された値を読む。
function storedData(userId: string): unknown {
  const raw = localStorage.getItem(`aims:reference:presets:${userId}`);
  return raw === null ? null : (JSON.parse(raw) as { data: unknown }).data;
}

describe("reference-snapshot", () => {
  it("保存したユーザーの識別で読める", () => {
    // Given
    saveReferenceSnapshot("presets", "user-1", { a: 1 }, 100);

    // When
    const loaded = loadReferenceSnapshot("presets");

    // Then
    expect(loaded).toEqual({ a: 1 });
  });

  it("種類が違うものは読めない", () => {
    // Given
    saveReferenceSnapshot("presets", "user-1", { a: 1 }, 100);

    // When
    const loaded = loadReferenceSnapshot("target-faces");

    // Then
    expect(loaded).toBeNull();
  });

  it("別のユーザーの識別では、前のユーザーの保存済みを読めない", () => {
    // Given
    saveReferenceSnapshot("presets", "user-1", { a: 1 }, 100);
    localStorage.setItem(IDENTITY_KEY, "user-2");

    // When
    const loaded = loadReferenceSnapshot("presets");

    // Then
    expect(loaded).toBeNull();
  });

  it("識別が無いときは読めない", () => {
    // Given
    saveReferenceSnapshot("presets", "user-1", { a: 1 }, 100);
    localStorage.removeItem(IDENTITY_KEY);

    // When
    const loaded = loadReferenceSnapshot("presets");

    // Then
    expect(loaded).toBeNull();
  });

  it("shapeが現在のselect文字列と違うものは、無いものとして扱う", () => {
    // Given
    localStorage.setItem(
      "aims:reference:presets:user-1",
      JSON.stringify({ shape: "id, old", startedAt: 1, data: { a: 1 } }),
    );

    // When
    const loaded = loadReferenceSnapshot("presets");

    // Then
    expect(loaded).toBeNull();
  });

  it("shapeが一致するものは読める", () => {
    // Given
    localStorage.setItem(
      "aims:reference:presets:user-1",
      JSON.stringify({
        shape: ROUND_PRESET_SELECT,
        startedAt: 1,
        data: { a: 1 },
      }),
    );

    // When
    const loaded = loadReferenceSnapshot("presets");

    // Then
    expect(loaded).toEqual({ a: 1 });
  });

  it.each([
    ["壊れたJSON", "{broken"],
    ["オブジェクトでない値", "123"],
    ["nullのJSON", "null"],
    ["startedAtが無い値", JSON.stringify({ shape: ROUND_PRESET_SELECT })],
  ])("%sは、投げずに無いものとして扱う", (_name, raw) => {
    // Given
    localStorage.setItem("aims:reference:presets:user-1", raw);

    // When
    const loaded = loadReferenceSnapshot("presets");

    // Then
    expect(loaded).toBeNull();
  });

  describe("localStorageが例外を投げる場合", () => {
    beforeEach(() => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota");
      });
    });

    it("保存は投げない", () => {
      // Given

      // When
      const save = () =>
        saveReferenceSnapshot("presets", "user-1", { a: 1 }, 100);

      // Then
      expect(save).not.toThrow();
    });

    it("読み出しは投げずにnullを返す", () => {
      // Given

      // When
      const loaded = loadReferenceSnapshot("presets");

      // Then
      expect(loaded).toBeNull();
    });

    it("書き換えは投げない", () => {
      // Given

      // When
      const update = () => updateReferenceSnapshot("presets", (d) => d);

      // Then
      expect(update).not.toThrow();
    });
  });

  it("保存済みより古いstartedAtの保存は書かれず、新しい方は書かれる", () => {
    // Given
    saveReferenceSnapshot("presets", "user-1", { v: "new" }, 200);

    // When
    saveReferenceSnapshot("presets", "user-1", { v: "old" }, 100);
    const afterOlder = loadReferenceSnapshot("presets");
    saveReferenceSnapshot("presets", "user-1", { v: "newer" }, 300);
    const afterNewer = loadReferenceSnapshot("presets");

    // Then
    expect(afterOlder).toEqual({ v: "new" });
    expect(afterNewer).toEqual({ v: "newer" });
  });

  describe("updateReferenceSnapshot", () => {
    it("保存済みが無いときは、書き換えず保存済みも作らない", () => {
      // Given

      // When
      updateReferenceSnapshot<{ n: number }>("presets", (d) => ({
        n: d.n + 1,
      }));

      // Then
      expect(loadReferenceSnapshot("presets")).toBeNull();
    });

    it("保存済みがあるときは書き換える", () => {
      // Given
      saveReferenceSnapshot("presets", "user-1", { n: 1 }, 100);

      // When
      updateReferenceSnapshot<{ n: number }>("presets", (d) => ({
        n: d.n + 1,
      }));

      // Then
      expect(loadReferenceSnapshot("presets")).toEqual({ n: 2 });
    });

    it("識別が無いときは何もしない", () => {
      // Given
      saveReferenceSnapshot("presets", "user-1", { n: 1 }, 100);
      localStorage.removeItem(IDENTITY_KEY);

      // When
      updateReferenceSnapshot<{ n: number }>("presets", () => ({ n: 9 }));

      // Then
      expect(storedData("user-1")).toEqual({ n: 1 });
    });

    it("書き換えの後に、書き換え前に始まった取得の保存をしても、戻らない", () => {
      // Given
      saveReferenceSnapshot("presets", "user-1", { n: 1 }, 100);
      updateReferenceSnapshot<{ n: number }>("presets", () => ({ n: 2 }));

      // When
      saveReferenceSnapshot("presets", "user-1", { n: 1 }, 100);

      // Then
      expect(loadReferenceSnapshot("presets")).toEqual({ n: 2 });
    });

    it("書き換えの関数が例外を投げても、保存済みを変えず、投げない", () => {
      // Given
      saveReferenceSnapshot("presets", "user-1", { n: 1 }, 100);

      // When
      const update = () =>
        updateReferenceSnapshot("presets", () => {
          throw new Error("boom");
        });

      // Then
      expect(update).not.toThrow();
      expect(loadReferenceSnapshot("presets")).toEqual({ n: 1 });
    });
  });
});
