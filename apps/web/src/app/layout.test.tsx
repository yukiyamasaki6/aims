import { SerwistProvider } from "@serwist/next/react";
import { render, screen } from "@testing-library/react";
import { Children, isValidElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalIdentityProvider } from "@/features/auth/local-identity-provider";
import RootLayout from "./layout";

// next/font/localはNext.jsのコンパイラによる変換を前提とし、Vitest上では実行できないため境界としてモックする。
vi.mock("geist/font/sans", () => ({
  GeistSans: { variable: "geist-sans-variable" },
}));

// SupabaseのSDKは外部サービスとの境界のため、描画時にLocalIdentityProviderが購読できるだけのスタブで模す。
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

// <html>・<body>はテスト用のコンテナ（div）の中に描画できないため、返される要素ツリーを検査し、描画は<body>の中身のみ行う。
function bodyContents(children: React.ReactNode): ReactElement[] {
  const body = RootLayout({ children }).props.children;
  return Children.toArray(body.props.children).filter(isValidElement);
}

function findSerwistProvider(children: React.ReactNode) {
  const provider = bodyContents(children).find(
    (element) => element.type === SerwistProvider,
  );
  if (!provider) throw new Error("SerwistProviderが含まれていません。");
  return provider.props as Record<string, unknown>;
}

describe("RootLayout", () => {
  describe("html要素", () => {
    it("日本語の文書としてフォントのCSS変数を適用する", () => {
      // Given
      const children = <p>子要素</p>;

      // When
      const html = RootLayout({ children });

      // Then
      expect(html.type).toBe("html");
      expect(html.props.lang).toBe("ja");
      expect(html.props.className).toBe("geist-sans-variable");
    });
  });

  describe("body要素", () => {
    it("子要素を表示する", () => {
      // Given
      const children = <p>子要素</p>;

      // When
      render(bodyContents(children));

      // Then
      expect(screen.getByText("子要素")).toBeInTheDocument();
    });

    it("端末ローカルの識別情報を追従させるLocalIdentityProviderを含める", () => {
      // Given
      const children = <p>子要素</p>;

      // When
      const contents = bodyContents(children);

      // Then
      expect(
        contents.some((element) => element.type === LocalIdentityProvider),
      ).toBe(true);
    });
  });

  describe("Service Worker", () => {
    it("/sw.jsを登録し、オンライン復帰時の再読み込みとナビゲーション時のキャッシュを行わない", () => {
      // Given
      const children = <p>子要素</p>;

      // When
      const props = findSerwistProvider(children);

      // Then
      expect(props.swUrl).toBe("/sw.js");
      expect(props.reloadOnOnline).toBe(false);
      expect(props.cacheOnNavigation).toBe(false);
    });

    it("本番環境では有効にする", () => {
      // Given
      vi.stubEnv("NODE_ENV", "production");

      // When
      const props = findSerwistProvider(<p>子要素</p>);

      // Then
      expect(props.disable).toBe(false);
    });

    it.each(["development", "test"])(
      "本番環境以外（%s）では無効にする",
      (nodeEnv) => {
        // Given
        vi.stubEnv("NODE_ENV", nodeEnv);

        // When
        const props = findSerwistProvider(<p>子要素</p>);

        // Then
        expect(props.disable).toBe(true);
      },
    );
  });
});
