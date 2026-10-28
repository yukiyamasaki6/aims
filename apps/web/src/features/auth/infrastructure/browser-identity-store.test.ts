import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserIdentityStore,
  getLocalIdentity,
} from "./browser-identity-store";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ブラウザの端末の識別情報", () => {
  it("初期状態では、識別情報が無い", () => {
    // Given

    // When
    const identity = getLocalIdentity();

    // Then
    expect(identity).toBeNull();
  });

  it("書いた利用者を読み出せる", () => {
    // Given
    const store = createBrowserIdentityStore();

    // When
    store.write("user-1");

    // Then
    expect(store.read()).toBe("user-1");
    expect(getLocalIdentity()).toBe("user-1");
  });

  it("nullを書くと消える", () => {
    // Given
    const store = createBrowserIdentityStore();
    store.write("user-1");

    // When
    store.write(null);

    // Then
    expect(store.read()).toBeNull();
  });

  it("記録は、新しく作った実装(ページの再読み込みを模す)からも読める", () => {
    // Given
    createBrowserIdentityStore().write("user-1");

    // When
    const identity = createBrowserIdentityStore().read();

    // Then
    expect(identity).toBe("user-1");
  });

  describe("localStorageが使用できない場合(プライベートブラウジングなど)", () => {
    it("読み出しは、エラーを投げずnullを返す", () => {
      // Given
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });

      // When
      const identity = getLocalIdentity();

      // Then
      expect(identity).toBeNull();
    });

    it("書き込みと消去は、エラーを投げず黙って無視する", () => {
      // Given
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("denied");
      });
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw new Error("denied");
      });
      const store = createBrowserIdentityStore();

      // When
      const write = () => {
        store.write("user-1");
        store.write(null);
      };

      // Then
      expect(write).not.toThrow();
    });
  });

  describe("windowが無い場合(サーバーでの描画中に誤って呼ばれたとき)", () => {
    it("読み出しはnullを返し、書き込みと消去は何もしない", () => {
      // Given
      const store = createBrowserIdentityStore();
      vi.stubGlobal("window", undefined);

      // When
      const write = () => {
        store.write("user-1");
        store.write(null);
      };
      const identity = store.read();

      // Then
      expect(identity).toBeNull();
      expect(write).not.toThrow();
    });
  });
});
