import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RootClientEntry } from "./root-client-entry";

// 画面のパッケージの遷移の部品は外部の境界のため、pushとreplaceを持つ1つの偽の部品に差し替える。
const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => nav.router }));

// 再読み込みを担う別の入口は別のテストで確かめるため、何も描かない代役に差し替える。
vi.mock("@/features/offline-pwa/ui/sw-update-activator", () => ({
  SwUpdateActivator: () => null,
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RootClientEntry", () => {
  describe("組み立て", () => {
    it("事前描画(サーバー側の描画)で生成しても、ブラウザの購読や大域の名前に触れず、投げない", () => {
      // Given
      const addWindow = vi.spyOn(window, "addEventListener");
      const addDocument = vi.spyOn(document, "addEventListener");

      // When
      const html = renderToString(
        <RootClientEntry>
          <p>子要素</p>
        </RootClientEntry>,
      );

      // Then
      expect(html).toContain("子要素");
      expect(addWindow).not.toHaveBeenCalled();
      expect(addDocument).not.toHaveBeenCalled();
      expect(nav.router.push).not.toHaveBeenCalled();
      expect(nav.router.replace).not.toHaveBeenCalled();
    });
  });
});
