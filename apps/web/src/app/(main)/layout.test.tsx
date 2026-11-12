import { type ReactNode, useState } from "react";
import { createSession } from "@/features/auth/application/session";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
import { createBrowserPageLoad } from "@/features/auth/infrastructure/browser-page-load";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { SessionProvider } from "@/features/auth/ui/session-context";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import { createClient } from "@/lib/supabase/infrastructure/client";

import "fake-indexeddb/auto";
import { act, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { RootClientEntry } from "../root-client-entry";
import MainLayout from "./layout";

const authText = translatorFor("auth");
const navigationText = translatorFor("navigation");

// 入口のテスト。SDK(@supabase/ssr)と、ブラウザの保存先(localStorage)・場所(location)の境界だけを差し替え、
// 手続き、実装、画面、確認ダイアログ、左パネルは実物を通す。
const supabase = vi.hoisted(() => {
  const listeners: Array<
    (event: string, session: { user: { id: string } } | null) => void
  > = [];
  const unsubscribe = vi.fn();
  return {
    listeners,
    unsubscribe,
    signOut: vi.fn(),
    getSession: vi.fn(),
    createBrowserClient: vi.fn(),
    emit(event: string, session: { user: { id: string } } | null) {
      for (const listener of listeners) listener(event, session);
    },
  };
});
// 画面のパッケージの遷移の部品は、アプリの外では得られないため、RootClientEntryが受け取れる偽に差し替える。
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn() }),
}));

// 常駐の同期と取得の部品は、この入口の関心の外のため、何も描画しない代役に差し替える。
vi.mock("../op-sync-provider", () => ({ OpSyncProvider: () => null }));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: supabase.createBrowserClient.mockImplementation(() => ({
    auth: {
      signOut: supabase.signOut,
      getSession: supabase.getSession,
      onAuthStateChange: (listener: (typeof supabase.listeners)[number]) => {
        supabase.listeners.push(listener);
        // 解除すると、実際にこのリスナーへ以降の出来事が届かなくなる(解除後の出来事を観測するため)。
        const unsubscribe = () => {
          supabase.unsubscribe();
          supabase.listeners.splice(supabase.listeners.indexOf(listener), 1);
        };
        return { data: { subscription: { unsubscribe } } };
      },
    },
  })),
}));

// 入口が渡すセッションの手続きを、実物で組み立てて渡す(識別情報の記録は含まない)。
function SessionWrapper({ children }: { children: ReactNode }) {
  const [session] = useState(() =>
    createSession({
      authenticator: createSupabaseAuth(createClient),
      pageReplace: createBrowserPageLoad(),
      recordUser: { isRecordUser: () => true },
      identity: createBrowserIdentityStore(),
      clock: createBrowserClock(),
    }),
  );
  return (
    <IntlTestProvider>
      <SessionProvider session={session}>{children}</SessionProvider>
    </IntlTestProvider>
  );
}

const replace = vi.fn();
const assign = vi.fn();
const IDENTITY_KEY = "aims:local-user-id";

function setLocation(pathname: string, search = "") {
  vi.stubGlobal("location", {
    href: `http://localhost${pathname}${search}`,
    origin: "http://localhost",
    replace,
    assign,
    pathname,
    search,
  });
}

function renderLayout() {
  return render(
    <MainLayout>
      <p>子要素</p>
    </MainLayout>,
    { wrapper: SessionWrapper },
  );
}

// ルートの識別情報の記録(実物)と合わせて描く。識別情報の消去は、この購読が担う。
function renderLayoutWithIdentity() {
  return render(
    <RootClientEntry>
      <MainLayout>
        <p>子要素</p>
      </MainLayout>
    </RootClientEntry>,
    { wrapper: IntlTestProvider },
  );
}

async function flush() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase.listeners.length = 0;
  localStorage.clear();
  localStorage.setItem(IDENTITY_KEY, "user-1");
  supabase.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-1" } } },
    error: null,
  });
  setLocation("/rounds/new");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("MainLayout", () => {
  describe("表示", () => {
    it("左パネルの2つの枠にサインアウトのボタンはなく、子要素と並べて表示する", () => {
      // Given
      // When
      renderLayout();

      // Then
      const frames = screen.getAllByRole("complementary");
      expect(frames).toHaveLength(2);
      for (const frame of frames) {
        expect(
          within(frame).queryByRole("button", { name: authText("signOut") }),
        ).toBeNull();
      }
      expect(screen.getByText("子要素")).toBeInTheDocument();
    });

    it("左パネルの2つの枠が、それぞれホーム・履歴・設定の項目を持つ", () => {
      // Given
      // When
      renderLayout();

      // Then
      for (const name of [
        "leftPanelHome",
        "leftPanelHistory",
        "leftPanelSettings",
      ] as const) {
        expect(
          screen.getAllByRole("link", { name: navigationText(name) }),
        ).toHaveLength(2);
      }
    });

    it("Supabaseの環境変数が無くても、描画時に接続を作らず描画できる", () => {
      // Given
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

      // When
      const render = () =>
        renderToString(
          <SessionWrapper>
            <MainLayout>
              <p>子要素</p>
            </MainLayout>
          </SessionWrapper>,
        );

      // Then
      expect(render).not.toThrow();
    });
  });

  // 環境変数の欠落は、起きる時点で保証が違う。事前描画は「表示」、依頼時の欠落は下、起動時の欠落は購読が同期に投げる(扱わない)。
  describe("環境変数の欠落", () => {
    function loseEnv() {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    }

    it("環境変数が無いままマウントすると、見張りの購読が同期に投げ、マウントが例外で終わる", () => {
      // Given
      loseEnv();
      vi.spyOn(console, "error").mockImplementation(() => {});

      // When
      const mount = () => renderLayout();

      // Then
      expect(mount).toThrow(
        "Missing Supabase environment variables in client.",
      );
    });
  });

  describe("セッション喪失の見張り", () => {
    it("表示すると、認証状態の変化の購読を1回始める", () => {
      // Given
      // When
      renderLayout();

      // Then
      expect(supabase.listeners).toHaveLength(1);
    });

    it("signed-outの通知を受けると、開いている画面を遷移元に付けて、ページ全体を置き換えてサインインへ移る", () => {
      // Given
      renderLayout();

      // When
      supabase.emit("SIGNED_OUT", null);

      // Then
      expect(replace).toHaveBeenCalledExactlyOnceWith(
        "/signin?returnTo=%2Frounds%2Fnew",
      );
      expect(assign).not.toHaveBeenCalled();
    });

    it("設定の画面でsigned-outの通知を受けると、/settingsを遷移元に付けてサインインへ移る", () => {
      // Given
      setLocation("/settings");
      renderLayout();

      // When
      supabase.emit("SIGNED_OUT", null);

      // Then
      expect(replace).toHaveBeenCalledExactlyOnceWith(
        "/signin?returnTo=%2Fsettings",
      );
    });

    it("表示した時にオンラインで未認証なら、サインインへ移る", async () => {
      // Given
      supabase.getSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      // When
      renderLayout();
      await flush();

      // Then
      expect(replace).toHaveBeenCalledExactlyOnceWith(
        "/signin?returnTo=%2Frounds%2Fnew",
      );
    });

    // 実物の入口(記録の起動、識別情報の記録、見張りの結線)を通す。見張りの購読が記録の起動より先に登録されても、起動時の通知は非同期で届くため記録の利用者が確定していることを固定する。
    it("識別情報が別の利用者のまま、起動時の復元の通知(INITIAL_SESSION)が来ると、今の場所を1回置き換え、識別情報を通知の利用者にする", async () => {
      // Given
      renderLayoutWithIdentity();
      await flush();

      // When
      act(() => supabase.emit("INITIAL_SESSION", { user: { id: "user-2" } }));

      // Then
      expect(replace).toHaveBeenCalledExactlyOnceWith("/rounds/new");
      expect(localStorage.getItem(IDENTITY_KEY)).toBe("user-2");
    });

    it("識別情報が同じ利用者なら、起動時の復元の通知が来ても、置き換えない", async () => {
      // Given
      renderLayoutWithIdentity();
      await flush();

      // When
      act(() => supabase.emit("INITIAL_SESSION", { user: { id: "user-1" } }));

      // Then
      expect(replace).not.toHaveBeenCalled();
      expect(localStorage.getItem(IDENTITY_KEY)).toBe("user-1");
    });

    it("離れた後にsigned-outが来ても、移らない", async () => {
      // Given
      const { unmount } = renderLayout();
      unmount();

      // When
      supabase.emit("SIGNED_OUT", null);
      await flush();

      // Then
      expect(replace).not.toHaveBeenCalled();
    });
  });
});
