import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
import { ROUND_PRESET_SELECT } from "./reference-query-constants";
import { createReferenceSnapshots } from "./reference-snapshot";

const IDENTITY_KEY = "aims:local-user-id";

const identityReader = createBrowserIdentityStore();
const snapshots = createReferenceSnapshots(identityReader);

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
    snapshots.save("presets", "user-1", { a: 1 }, 100);

    // When
    const loaded = snapshots.load("presets");

    // Then
    expect(loaded).toEqual({ a: 1 });
  });

  it("種類が違うものは読めない", () => {
    // Given
    snapshots.save("presets", "user-1", { a: 1 }, 100);

    // When
    const loaded = snapshots.load("target-faces");

    // Then
    expect(loaded).toBeNull();
  });

  it("別のユーザーの識別では、前のユーザーの保存済みを読めない", () => {
    // Given
    snapshots.save("presets", "user-1", { a: 1 }, 100);
    localStorage.setItem(IDENTITY_KEY, "user-2");

    // When
    const loaded = snapshots.load("presets");

    // Then
    expect(loaded).toBeNull();
  });

  it("同じ読み手で、識別が変わる前後に続けて読むと、そのときの識別の保存済みを読む", () => {
    // Given
    snapshots.save("presets", "user-a", { owner: "a" }, 100);
    snapshots.save("presets", "user-b", { owner: "b" }, 100);
    localStorage.setItem(IDENTITY_KEY, "user-a");

    // When
    const beforeChange = snapshots.load("presets");
    localStorage.setItem(IDENTITY_KEY, "user-b");
    const afterChange = snapshots.load("presets");

    // Then
    expect(beforeChange).toEqual({ owner: "a" });
    expect(afterChange).toEqual({ owner: "b" });
  });

  it("識別が無いときは読めない", () => {
    // Given
    snapshots.save("presets", "user-1", { a: 1 }, 100);
    localStorage.removeItem(IDENTITY_KEY);

    // When
    const loaded = snapshots.load("presets");

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
    const loaded = snapshots.load("presets");

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
    const loaded = snapshots.load("presets");

    // Then
    expect(loaded).toEqual({ a: 1 });
  });

  it("保存済みより古いstartedAtの保存は書かれず、新しい方は書かれる", () => {
    // Given
    snapshots.save("presets", "user-1", { v: "new" }, 200);

    // When
    snapshots.save("presets", "user-1", { v: "old" }, 100);
    const afterOlder = snapshots.load("presets");
    snapshots.save("presets", "user-1", { v: "newer" }, 300);
    const afterNewer = snapshots.load("presets");

    // Then
    expect(afterOlder).toEqual({ v: "new" });
    expect(afterNewer).toEqual({ v: "newer" });
  });

  describe("update", () => {
    it("保存済みが無いときは、書き換えず保存済みも作らない", () => {
      // Given

      // When
      snapshots.update<{ n: number }>("presets", (d) => ({
        n: d.n + 1,
      }));

      // Then
      expect(snapshots.load("presets")).toBeNull();
    });

    it("保存済みがあるときは書き換える", () => {
      // Given
      snapshots.save("presets", "user-1", { n: 1 }, 100);

      // When
      snapshots.update<{ n: number }>("presets", (d) => ({
        n: d.n + 1,
      }));

      // Then
      expect(snapshots.load("presets")).toEqual({
        n: 2,
      });
    });

    it("同じ読み手で、識別が変わる前後に続けて書き換えると、そのときの識別の保存済みだけを書き換える", () => {
      // Given
      snapshots.save("presets", "user-a", { n: 1 }, 100);
      snapshots.save("presets", "user-b", { n: 10 }, 100);
      localStorage.setItem(IDENTITY_KEY, "user-a");
      const increment = (d: { n: number }) => ({ n: d.n + 1 });

      // When
      snapshots.update<{ n: number }>("presets", increment);
      const afterFirst = [storedData("user-a"), storedData("user-b")];
      localStorage.setItem(IDENTITY_KEY, "user-b");
      snapshots.update<{ n: number }>("presets", increment);

      // Then
      expect(afterFirst).toEqual([{ n: 2 }, { n: 10 }]);
      expect(storedData("user-a")).toEqual({ n: 2 });
      expect(storedData("user-b")).toEqual({ n: 11 });
    });

    it("識別が無いときは何もしない", () => {
      // Given
      snapshots.save("presets", "user-1", { n: 1 }, 100);
      localStorage.removeItem(IDENTITY_KEY);

      // When
      snapshots.update<{ n: number }>("presets", () => ({
        n: 9,
      }));

      // Then
      expect(storedData("user-1")).toEqual({ n: 1 });
    });

    it("書き換えの後に、書き換え前に始まった取得の保存をしても、戻らない", () => {
      // Given
      snapshots.save("presets", "user-1", { n: 1 }, 100);
      snapshots.update<{ n: number }>("presets", () => ({
        n: 2,
      }));

      // When
      snapshots.save("presets", "user-1", { n: 1 }, 100);

      // Then
      expect(snapshots.load("presets")).toEqual({
        n: 2,
      });
    });
  });
});

describe("createReferenceSnapshots", () => {
  it("読み込みは端末の識別情報の利用者のキーで、保存は渡した利用者のキーで行う", () => {
    // Given
    localStorage.setItem(IDENTITY_KEY, "user-a");

    // When
    snapshots.save("target-faces", "user-a", [{ id: "face-1" }], 100);
    snapshots.save("target-faces", "user-b", [{ id: "face-2" }], 100);
    const loaded = snapshots.load("target-faces");

    // Then
    expect(loaded).toEqual([{ id: "face-1" }]);
  });

  it("端末の識別情報が無いときは、保存済みがあっても読めない", () => {
    // Given
    snapshots.save("target-faces", "user-1", [{ id: "face-1" }], 100);
    localStorage.removeItem(IDENTITY_KEY);

    // When
    const loaded = snapshots.load("target-faces");

    // Then
    expect(loaded).toBeNull();
  });
});
