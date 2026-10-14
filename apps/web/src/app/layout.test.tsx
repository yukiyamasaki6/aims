import { SerwistProvider } from "@serwist/next/react";
import { render, screen } from "@testing-library/react";
import { Children, isValidElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalIdentityProvider } from "@/features/auth/local-identity-provider";
import RootLayout, { metadata, viewport } from "./layout";
import { OpSyncProvider } from "./op-sync-provider";
import { SwUpdateActivator } from "./sw-update-activator";

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

    it("どの画面でも操作の列を送るOpSyncProviderを含める", () => {
      // Given
      const children = <p>子要素</p>;

      // When
      const contents = bodyContents(children);

      // Then
      expect(contents.some((element) => element.type === OpSyncProvider)).toBe(
        true,
      );
    });

    it("waitingの新SWの有効化を再要求するSwUpdateActivatorを含める", () => {
      // Given
      const children = <p>子要素</p>;

      // When
      const contents = bodyContents(children);

      // Then
      expect(
        contents.some((element) => element.type === SwUpdateActivator),
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

  describe("viewportとmetadata", () => {
    it("width=device-width、initial-scale=1、viewport-fit=coverを持ち、interactive-widgetはresizes-contentのまま、拡大を禁じない", () => {
      // Given
      // When
      const result = viewport;

      // Then
      expect(result).toMatchObject({
        width: "device-width",
        initialScale: 1,
        viewportFit: "cover",
        interactiveWidget: "resizes-content",
      });
      expect(result).not.toHaveProperty("userScalable");
      expect(result).not.toHaveProperty("maximumScale");
    });

    it("iOSの起動画面の指定（appleWebApp.startupImageと、起動画面のlink）を持たない", () => {
      // Given
      // 起動画面のlinkは、appleWebApp.startupImageのほか、other（メタ名）とicons.other（rel）でも指定できる。
      const appleWebApp =
        typeof metadata.appleWebApp === "object" ? metadata.appleWebApp : null;
      const otherNames = Object.keys(metadata.other ?? {});
      const icons = metadata.icons;
      const iconsOther = (
        icons && typeof icons === "object" && "other" in icons
          ? [icons.other ?? []].flat()
          : []
      ).map((icon) => icon.rel);

      // When
      const found = [
        appleWebApp?.startupImage,
        ...otherNames.filter((name) => /startup/i.test(name)),
        ...iconsOther.filter((rel) => /startup/i.test(rel ?? "")),
      ].filter((value) => value !== undefined);

      // Then
      expect(found).toEqual([]);
    });
  });
});
