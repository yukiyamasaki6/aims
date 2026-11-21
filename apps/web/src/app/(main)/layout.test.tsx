import { type ReactNode, useState } from "react";
import { createFakeAccountSummaryStore } from "@/features/auth/application/account-summary-store-test-helpers";
import { createLinkGoogle } from "@/features/auth/application/link-google";
import {
  createFakeEmailIdentityPreparation,
  createFakeLinkGoogleAuthenticator,
  readingOf,
} from "@/features/auth/application/link-google-test-helpers";
import { createSession } from "@/features/auth/application/session";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
import { createBrowserPageLoad } from "@/features/auth/infrastructure/browser-page-load";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { LinkGoogleProvider } from "@/features/auth/ui/link-google-context";
import { SessionProvider } from "@/features/auth/ui/session-context";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import { createClient } from "@/lib/supabase/infrastructure/client";

import "fake-indexeddb/auto";
import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import {
  type FakeViewport,
  installFakeViewport,
} from "@/lib/viewport/fake-viewport-test-helpers";
import { SETTINGS_ACCOUNT_HASH } from "@/routes";
import MainLayout from "./layout";

const settingsText = translatorFor("settings");

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

// Googleアカウントの追加の手続き。戻りの預かりは実物で、認証サービスと記録は偽物にする。
function createLinkGoogleForTest() {
  const summary = {
    userId: "user-1",
    email: "user@example.com",
    google: null,
  };
  return createLinkGoogle({
    authenticator: createFakeLinkGoogleAuthenticator(readingOf(summary)),
    emailIdentity: createFakeEmailIdentityPreparation(),
    summaries: createFakeAccountSummaryStore(summary),
    connectivity: createFakeConnectivity(),
  });
}

// 入口が渡すセッションの手続きを、実物で組み立てて渡す(識別情報の記録は含まない)。
function SessionWrapper({ children }: { children: ReactNode }) {
  const [session] = useState(() =>
    createSession({
      authenticator: createSupabaseAuth(createClient),
      pageReplace: createBrowserPageLoad(),
      recordUser: { isRecordUser: () => true },
      identity: createBrowserIdentityStore(),
      clock: createBrowserClock(),
      connectivity: createFakeConnectivity(),
    }),
  );
  const [linkGoogle] = useState(createLinkGoogleForTest);
  return (
    <IntlTestProvider>
      <SessionProvider session={session}>
        <LinkGoogleProvider linkGoogle={linkGoogle}>
          {children}
        </LinkGoogleProvider>
      </SessionProvider>
    </IntlTestProvider>
  );
}

const replace = vi.fn();
const assign = vi.fn();
const reload = vi.fn();
const IDENTITY_KEY = "aims:local-user-id";

// location.replace・assignだけを差し替える。パス・クエリ・ハッシュは、jsdomの実の場所(履歴)を読む。設定パネルがhistory.pushStateでハッシュを書くため。
function setLocation(pathname: string, search = "", hash = "") {
  window.history.replaceState(null, "", pathname + search + hash);
  const real = window.location;
  vi.stubGlobal("location", {
    get href() {
      return real.href;
    },
    origin: "http://localhost",
    replace,
    assign,
    reload,
    get pathname() {
      return real.pathname;
    },
    get search() {
      return real.search;
    },
    get hash() {
      return real.hash;
    },
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

async function flush() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

// jsdomにmatchMediaが無いため、入口の表示領域の補償が読む名前を、タブ(補償しない)の偽物で差す。
let viewport: FakeViewport;

beforeEach(() => {
  vi.clearAllMocks();
  viewport = installFakeViewport();
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
  viewport.restore();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("MainLayout", () => {
  describe("表示", () => {
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

  describe("設定パネル", () => {
    function panel() {
      return screen.queryByRole("dialog", { name: settingsText("title") });
    }

    it.each([
      ["#settings/account", true],
      ["#settings/account/email", true],
      ["#settingsfoo", false],
      ["", false],
    ])(
      "ハッシュが%sのとき、設定パネルを表示するのは%sである",
      async (hash, shown) => {
        // Given
        setLocation("/rounds/new", "", hash);

        // When
        renderLayout();
        await flush();

        // Then
        expect(panel() !== null).toBe(shown);
      },
    );
  });

  describe("Googleアカウントの追加の戻り", () => {
    it.each([
      ["codeの戻り", `?link-google=1&code=auth-code`],
      [
        "取り消しの戻り",
        "?link-google=1&error=access_denied&error_description=cancelled",
      ],
    ])(
      "印つきの%sで開くと、戻りを外したURLに書き換え、設定パネルを分類「アカウント」で1回開く",
      async (_name, search) => {
        // Given
        setLocation("/rounds/new", search);
        const pushState = vi.spyOn(window.history, "pushState");

        // When
        renderLayout();
        await flush();

        // Then
        expect(window.location.search).toBe("");
        expect(pushState).toHaveBeenCalledTimes(1);
        expect(window.location.hash).toBe(SETTINGS_ACCOUNT_HASH);
        expect(
          screen.getByRole("dialog", { name: settingsText("title") }),
        ).toBeInTheDocument();
      },
    );

    it.each([
      ["戻りが無い", ""],
      ["印の無いcodeの", "?code=auth-code"],
    ])(
      "%sURLで開くと、URLを変えず、設定パネルを開かない",
      async (_name, search) => {
        // Given
        setLocation("/rounds/new", search);
        const pushState = vi.spyOn(window.history, "pushState");

        // When
        renderLayout();
        await flush();

        // Then
        expect(window.location.search).toBe(search);
        expect(pushState).not.toHaveBeenCalled();
        expect(window.location.hash).toBe("");
      },
    );
  });
});
