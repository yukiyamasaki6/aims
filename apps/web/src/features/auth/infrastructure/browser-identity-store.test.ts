import { beforeEach, describe, expect, it } from "vitest";
import { createBrowserIdentityStore } from "./browser-identity-store";

beforeEach(() => {
  localStorage.clear();
});

describe("ブラウザの端末の識別情報", () => {
  it("初期状態では、識別情報が無い", () => {
    // Given

    // When
    const identity = createBrowserIdentityStore().read();

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
    expect(createBrowserIdentityStore().read()).toBe("user-1");
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
});
