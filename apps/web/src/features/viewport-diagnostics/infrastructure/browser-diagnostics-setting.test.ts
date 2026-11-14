import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserDiagnosticsSetting } from "./browser-diagnostics-setting";

const KEY = "aims:viewport-diagnostics";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function fireStorage(key: string | null, newValue: string | null) {
  window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
}

describe("createBrowserDiagnosticsSetting", () => {
  describe("保存と読み取り", () => {
    it("保存が無ければ無効である", () => {
      // Given
      // When
      const enabled = createBrowserDiagnosticsSetting().read();

      // Then
      expect(enabled).toBe(false);
    });

    it("有効を書くと、新しく作った実装(再読み込みを模す)からも有効で読める", () => {
      // Given
      createBrowserDiagnosticsSetting().write(true);

      // When
      const enabled = createBrowserDiagnosticsSetting().read();

      // Then
      expect(enabled).toBe(true);
    });

    it("有効にした後に無効を書くと、新しく作った実装からも無効で読める", () => {
      // Given
      const setting = createBrowserDiagnosticsSetting();
      setting.write(true);

      // When
      setting.write(false);

      // Then
      expect(createBrowserDiagnosticsSetting().read()).toBe(false);
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    // 値そのものが検証の対象のため、実際には書かれない形を使う。
    it.each([
      ["1", true],
      ["0", false],
      ["true", false],
      ["", false],
    ])("保存値が%jのとき、有効かは%jである", (stored, expected) => {
      // Given
      localStorage.setItem(KEY, stored);

      // When
      const enabled = createBrowserDiagnosticsSetting().read();

      // Then
      expect(enabled).toBe(expected);
    });
  });

  describe("購読", () => {
    it("書くと購読者へ知らせ、解除した購読者へは知らせない", () => {
      // Given
      const setting = createBrowserDiagnosticsSetting();
      const kept = vi.fn();
      const removed = vi.fn();
      setting.subscribe(kept);
      setting.subscribe(removed)();

      // When
      setting.write(true);

      // Then
      expect(kept).toHaveBeenCalledTimes(1);
      expect(removed).not.toHaveBeenCalled();
    });

    it("別タブの同じキーの変更(storageイベント)で値を更新し、購読者へ知らせる", () => {
      // Given
      const setting = createBrowserDiagnosticsSetting();
      const listener = vi.fn();
      setting.subscribe(listener);
      expect(setting.read()).toBe(false);

      // When
      localStorage.setItem(KEY, "1");
      fireStorage(KEY, "1");

      // Then
      expect(setting.read()).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("別タブが同じキーを消した(newValueがnull)とき、無効へ更新して知らせる", () => {
      // Given
      const setting = createBrowserDiagnosticsSetting();
      setting.write(true);
      const listener = vi.fn();
      setting.subscribe(listener);

      // When
      localStorage.removeItem(KEY);
      fireStorage(KEY, null);

      // Then
      expect(setting.read()).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("別タブが全て消した(keyがnull。clear)とき、無効へ更新して知らせる", () => {
      // Given
      const setting = createBrowserDiagnosticsSetting();
      setting.write(true);
      const listener = vi.fn();
      setting.subscribe(listener);

      // When
      localStorage.clear();
      fireStorage(null, null);

      // Then
      expect(setting.read()).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("別のキーの変更では、値を変えず知らせない", () => {
      // Given
      const setting = createBrowserDiagnosticsSetting();
      setting.write(true);
      const listener = vi.fn();
      setting.subscribe(listener);

      // When
      fireStorage("aims:other", null);

      // Then
      expect(setting.read()).toBe(true);
      expect(listener).not.toHaveBeenCalled();
    });

    it("購読を全て解除した後のstorageイベントでは、知らせない", () => {
      // Given
      const setting = createBrowserDiagnosticsSetting();
      const listener = vi.fn();
      setting.subscribe(listener)();

      // When
      localStorage.setItem(KEY, "1");
      fireStorage(KEY, "1");

      // Then
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("保存先を使えないとき", () => {
    it("読み取りが例外を投げても、readは無効を返し例外にしない", () => {
      // Given
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });
      const setting = createBrowserDiagnosticsSetting();

      // When
      const read = () => setting.read();

      // Then
      expect(read).not.toThrow();
      expect(read()).toBe(false);
    });

    it("保存が例外を投げても、有効を書けて、そのセッションでは有効で読め、購読者へ知らせる", () => {
      // Given
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota");
      });
      const setting = createBrowserDiagnosticsSetting();
      const listener = vi.fn();
      setting.subscribe(listener);

      // When
      const write = () => setting.write(true);

      // Then
      expect(write).not.toThrow();
      expect(setting.read()).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("削除が例外を投げても、無効を書けて、そのセッションでは無効で読め、購読者へ知らせる", () => {
      // Given
      const setting = createBrowserDiagnosticsSetting();
      setting.write(true);
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw new Error("denied");
      });
      const listener = vi.fn();
      setting.subscribe(listener);

      // When
      const write = () => setting.write(false);

      // Then
      expect(write).not.toThrow();
      expect(setting.read()).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
