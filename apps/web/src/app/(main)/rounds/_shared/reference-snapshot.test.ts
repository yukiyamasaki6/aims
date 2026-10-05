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

describe("reference-snapshot", () => {
  it("保存したユーザーの識別で読める", () => {
    saveReferenceSnapshot("presets", "user-1", { a: 1 }, 100);

    expect(loadReferenceSnapshot("presets")).toEqual({ a: 1 });
  });

  it("種類が違うものは読めない", () => {
    saveReferenceSnapshot("presets", "user-1", { a: 1 }, 100);

    expect(loadReferenceSnapshot("target-faces")).toBeNull();
  });

  it("別のユーザーの識別では、前のユーザーの保存済みを読めない", () => {
    saveReferenceSnapshot("presets", "user-1", { a: 1 }, 100);
    localStorage.setItem(IDENTITY_KEY, "user-2");

    expect(loadReferenceSnapshot("presets")).toBeNull();
  });

  it("識別が無いときは読めない", () => {
    saveReferenceSnapshot("presets", "user-1", { a: 1 }, 100);
    localStorage.removeItem(IDENTITY_KEY);

    expect(loadReferenceSnapshot("presets")).toBeNull();
  });

  it("shapeが現在のselect文字列と違うものは、無いものとして扱う", () => {
    localStorage.setItem(
      "aims:reference:presets:user-1",
      JSON.stringify({ shape: "id, old", startedAt: 1, data: { a: 1 } }),
    );

    expect(loadReferenceSnapshot("presets")).toBeNull();
  });

  it("shapeが一致するものは読める", () => {
    localStorage.setItem(
      "aims:reference:presets:user-1",
      JSON.stringify({
        shape: ROUND_PRESET_SELECT,
        startedAt: 1,
        data: { a: 1 },
      }),
    );

    expect(loadReferenceSnapshot("presets")).toEqual({ a: 1 });
  });

  it.each([
    ["壊れたJSON", "{broken"],
    ["オブジェクトでない値", "123"],
    ["nullのJSON", "null"],
    ["startedAtが無い値", JSON.stringify({ shape: ROUND_PRESET_SELECT })],
  ])("%sは、投げずに無いものとして扱う", (_name, raw) => {
    localStorage.setItem("aims:reference:presets:user-1", raw);

    expect(loadReferenceSnapshot("presets")).toBeNull();
  });

  it("localStorageが例外を投げても、読み書きは投げない", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    expect(() =>
      saveReferenceSnapshot("presets", "user-1", { a: 1 }, 100),
    ).not.toThrow();
    expect(loadReferenceSnapshot("presets")).toBeNull();
    expect(() => updateReferenceSnapshot("presets", (d) => d)).not.toThrow();
  });

  it("保存済みより古いstartedAtの保存は書かれず、新しい方は書かれる", () => {
    saveReferenceSnapshot("presets", "user-1", { v: "new" }, 200);

    saveReferenceSnapshot("presets", "user-1", { v: "old" }, 100);
    expect(loadReferenceSnapshot("presets")).toEqual({ v: "new" });

    saveReferenceSnapshot("presets", "user-1", { v: "newer" }, 300);
    expect(loadReferenceSnapshot("presets")).toEqual({ v: "newer" });
  });

  describe("updateReferenceSnapshot", () => {
    it("保存済みがあるときだけ書き換える", () => {
      updateReferenceSnapshot<{ n: number }>("presets", (d) => ({
        n: d.n + 1,
      }));
      expect(loadReferenceSnapshot("presets")).toBeNull();

      saveReferenceSnapshot("presets", "user-1", { n: 1 }, 100);
      updateReferenceSnapshot<{ n: number }>("presets", (d) => ({
        n: d.n + 1,
      }));

      expect(loadReferenceSnapshot("presets")).toEqual({ n: 2 });
    });

    it("識別が無いときは何もしない", () => {
      saveReferenceSnapshot("presets", "user-1", { n: 1 }, 100);
      localStorage.removeItem(IDENTITY_KEY);

      updateReferenceSnapshot<{ n: number }>("presets", () => ({ n: 9 }));
      localStorage.setItem(IDENTITY_KEY, "user-1");

      expect(loadReferenceSnapshot("presets")).toEqual({ n: 1 });
    });

    it("書き換えの後に、書き換え前に始まった取得の保存をしても、戻らない", () => {
      saveReferenceSnapshot("presets", "user-1", { n: 1 }, 100);
      updateReferenceSnapshot<{ n: number }>("presets", () => ({ n: 2 }));

      saveReferenceSnapshot("presets", "user-1", { n: 1 }, 100);

      expect(loadReferenceSnapshot("presets")).toEqual({ n: 2 });
    });

    it("書き換えの関数が例外を投げても、保存済みを変えず、投げない", () => {
      saveReferenceSnapshot("presets", "user-1", { n: 1 }, 100);

      expect(() =>
        updateReferenceSnapshot("presets", () => {
          throw new Error("boom");
        }),
      ).not.toThrow();
      expect(loadReferenceSnapshot("presets")).toEqual({ n: 1 });
    });
  });
});
