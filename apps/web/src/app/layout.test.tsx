import "fake-indexeddb/auto";
import { SerwistProvider } from "@serwist/next/react";
import { Children, isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FakeViewport,
  installFakeViewport,
} from "@/lib/viewport/fake-viewport-test-helpers";
import RootLayout from "./layout";
import { RootClientEntry } from "./root-client-entry";

// next/font/localはNext.jsのコンパイラによる変換を前提とし、Vitest上では実行できないため境界としてモックする。
vi.mock("geist/font/sans", () => ({
  GeistSans: { variable: "geist-sans-variable" },
}));

// 画面のパッケージの遷移の部品は、アプリの外では得られないため、RootClientEntryが受け取れる偽に差し替える。
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn() }),
}));

// SupabaseのSDKは外部サービスとの境界のため、描画時にRootClientEntryが購読できるだけのスタブで模す。
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
  }),
}));

// jsdomにmatchMediaが無いため、入口の表示領域の補償が読む名前を、タブ(補償しない)の偽物で差す。
let viewport: FakeViewport;

beforeEach(() => {
  viewport = installFakeViewport();
});

afterEach(() => {
  viewport.restore();
  vi.unstubAllEnvs();
});

// <html>・<body>はテスト用のコンテナ（div）の中に描画できないため、返される要素ツリーを検査し、描画は<body>の中身のみ行う。
function bodyContents(children: React.ReactNode): ReactElement[] {
  const body = RootLayout({ children }).props.children;
  return Children.toArray(body.props.children).filter(isValidElement);
}

// 起動地点の入口が、アプリの全体(Service Workerの登録を含む)を包む。
function findSerwistProvider(children: React.ReactNode) {
  const entry = bodyContents(children).find(
    (element) => element.type === RootClientEntry,
  );
  const provider = Children.toArray(
    (entry?.props as { children?: React.ReactNode } | undefined)?.children,
  )
    .filter(isValidElement)
    .find((element) => element.type === SerwistProvider);
  if (!provider) throw new Error("SerwistProviderが含まれていません。");
  return provider.props as Record<string, unknown>;
}

describe("RootLayout", () => {
  describe("Service Worker", () => {
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
