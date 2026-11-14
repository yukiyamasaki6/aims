import { type ReactNode, useState } from "react";
import { createSession } from "@/features/auth/application/session";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
import { createBrowserPageLoad } from "@/features/auth/infrastructure/browser-page-load";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { SessionProvider } from "@/features/auth/ui/session-context";
import { createBrowserDiagnosticsSetting } from "@/features/viewport-diagnostics/infrastructure/browser-diagnostics-setting";
import { ViewportDiagnosticsProvider } from "@/features/viewport-diagnostics/ui/viewport-diagnostics-provider";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import { createClient } from "@/lib/supabase/infrastructure/client";

import "fake-indexeddb/auto";
import { AuthApiError } from "@supabase/supabase-js";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import {
  type FakeViewport,
  installFakeViewport,
} from "@/lib/viewport/fake-viewport-test-helpers";
import { RootClientEntry } from "../../root-client-entry";
import MainLayout from "../layout";
import SettingsPage from "./page";

const authText = translatorFor("auth");
const settingsText = translatorFor("settings");
const diagnosticsText = translatorFor("viewportDiagnostics");

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
  const [diagnosticsSetting] = useState(createBrowserDiagnosticsSetting);
  return (
    <IntlTestProvider>
      <ViewportDiagnosticsProvider setting={diagnosticsSetting}>
        <SessionProvider session={session}>{children}</SessionProvider>
      </ViewportDiagnosticsProvider>
    </IntlTestProvider>
  );
}

const replace = vi.fn();
const assign = vi.fn();
const IDENTITY_KEY = "aims:local-user-id";
const DIAGNOSTICS_KEY = "aims:viewport-diagnostics";
const NETWORK_ERROR = authText("failure.unreachable");
const RATE_LIMIT_ERROR = new AuthApiError(
  "limit",
  429,
  "over_request_rate_limit",
);

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

// SDKのsignOut({ scope: "local" })は、通信の成否に関わらずローカルのセッションを削除できた場合にSIGNED_OUTを発火し、以後のgetSessionはセッションを返さない。
// 端末の識別情報は直接消さず、ルートの購読(RootClientEntry。renderLayoutWithIdentityで実物を描く)がこの出来事で消す。
function signOutClearingSession(result: () => Promise<unknown>) {
  supabase.signOut.mockImplementation(async () => {
    supabase.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    supabase.emit("SIGNED_OUT", null);
    return result();
  });
}

// 設定の画面に区画は1つで、サインアウトのボタンも1つである(左パネルは持たない)。
function signOutButton() {
  return screen.getByRole("button", { name: authText("signOut") });
}

async function confirmSignOut(user: ReturnType<typeof userEvent.setup>) {
  await user.click(signOutButton());
  await user.click(screen.getByTestId("confirm-dialog-confirm"));
}

// 本番の構成と同じく、セッション喪失の見張りを持つレイアウトの中に設定の画面を描く。
function renderPage() {
  return render(
    <MainLayout>
      <SettingsPage />
    </MainLayout>,
    { wrapper: SessionWrapper },
  );
}

// ルートの識別情報の記録(実物)と合わせて描く。識別情報の消去は、この購読が担う。
function renderPageWithIdentity() {
  return render(
    <RootClientEntry>
      <MainLayout>
        <SettingsPage />
      </MainLayout>
    </RootClientEntry>,
    { wrapper: IntlTestProvider },
  );
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
  setLocation("/settings");
});

afterEach(() => {
  viewport.restore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("SettingsPage", () => {
  describe("表示", () => {
    it("設定の画面の「アカウント」の区画の中に、サインアウトのボタンを1つ表示する", () => {
      // Given
      // When
      renderPage();

      // Then
      const region = screen.getByRole("region", {
        name: settingsText("accountTitle"),
      });
      expect(
        within(region).getByRole("button", {
          name: authText("signOut"),
        }),
      ).toBeInTheDocument();
      expect(
        screen.getAllByRole("button", { name: authText("signOut") }),
      ).toHaveLength(1);
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
              <SettingsPage />
            </MainLayout>
          </SessionWrapper>,
        );

      // Then
      expect(render).not.toThrow();
    });
  });

  describe("表示領域の診断", () => {
    function diagnosticsSwitch() {
      return screen.getByRole("switch", {
        name: diagnosticsText("toggleLabel"),
      });
    }

    function badge() {
      return screen.queryByTestId("viewport-diagnostics-badge");
    }

    it("設定の画面に、診断のスイッチをオフで表示し、バッジは表示しない", () => {
      // Given
      // When
      renderPageWithIdentity();

      // Then
      expect(diagnosticsSwitch()).not.toBeChecked();
      expect(badge()).toBeNull();
    });

    it("スイッチを押すと、バッジを表示し、端末の保存へ有効を書く", async () => {
      // Given
      const user = userEvent.setup();
      renderPageWithIdentity();

      // When
      await user.click(diagnosticsSwitch());

      // Then
      expect(badge()).toBeInTheDocument();
      expect(localStorage.getItem(DIAGNOSTICS_KEY)).toBe("1");
    });

    it("有効にした後、画面を破棄して描き直しても(再読み込みを模す)、スイッチはオンでバッジを表示する", async () => {
      // Given
      const user = userEvent.setup();
      const first = renderPageWithIdentity();
      await user.click(diagnosticsSwitch());
      first.unmount();

      // When
      renderPageWithIdentity();

      // Then
      expect(diagnosticsSwitch()).toBeChecked();
      expect(badge()).toBeInTheDocument();
    });

    it("有効にした後、スイッチを押して無効に戻すと、バッジが消え、保存が無くなる", async () => {
      // Given
      const user = userEvent.setup();
      renderPageWithIdentity();
      await user.click(diagnosticsSwitch());

      // When
      await user.click(diagnosticsSwitch());

      // Then
      expect(badge()).toBeNull();
      expect(localStorage.getItem(DIAGNOSTICS_KEY)).toBeNull();
    });

    it("有効にした後、サインアウトを確認しても、診断の保存は消えない(端末の識別情報は消える)", async () => {
      // Given
      const user = userEvent.setup();
      signOutClearingSession(async () => ({ error: null }));
      renderPageWithIdentity();
      await user.click(diagnosticsSwitch());

      // When
      await confirmSignOut(user);

      // Then
      expect(localStorage.getItem(IDENTITY_KEY)).toBeNull();
      expect(localStorage.getItem(DIAGNOSTICS_KEY)).toBe("1");
    });
  });

  describe("キーボード操作", () => {
    it("Tabでサインアウトのボタンへフォーカスが届き、Enterで確認のダイアログが開く", async () => {
      // Given
      const user = userEvent.setup();
      renderPage();
      const button = signOutButton();

      // When
      for (let i = 0; i < 30 && document.activeElement !== button; i++)
        await user.tab();
      const focused = document.activeElement;
      await user.keyboard("{Enter}");

      // Then
      expect(focused).toBe(button);
      expect(screen.getByText(authText("signOutConfirm"))).toBeInTheDocument();
    });
  });

  // 環境変数の欠落のうち、依頼時の欠落を扱う。事前描画は「表示」、起動時の欠落はレイアウトのテストが扱う。
  describe("環境変数の欠落", () => {
    function loseEnv() {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    }

    it("マウントの後、確認の前に環境変数が失われたときは、通信エラーを示してダイアログを開いたままボタンを戻す", async () => {
      // Given
      const user = userEvent.setup();
      renderPageWithIdentity();
      loseEnv();

      // When
      await confirmSignOut(user);

      // Then
      expect(await screen.findByText(NETWORK_ERROR)).toBeInTheDocument();
      expect(screen.getByText(authText("signOutConfirm"))).toBeInTheDocument();
      expect(screen.getByTestId("confirm-dialog-confirm")).toHaveAttribute(
        "aria-disabled",
        "false",
      );
      expect(supabase.signOut).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
    });

    it("環境変数が失われた確認の後、環境変数を戻して再度確認すると、接続を取得し直して完了し、遷移元を付けずに移る", async () => {
      // Given
      const user = userEvent.setup();
      renderPageWithIdentity();
      loseEnv();
      await confirmSignOut(user);
      await screen.findByText(NETWORK_ERROR);
      const connectionsWhileLost =
        supabase.createBrowserClient.mock.calls.length;
      vi.unstubAllEnvs();
      signOutClearingSession(async () => ({ error: null }));

      // When
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then
      expect(supabase.signOut).toHaveBeenCalledExactlyOnceWith({
        scope: "local",
      });
      expect(supabase.createBrowserClient.mock.calls.length).toBeGreaterThan(
        connectionsWhileLost,
      );
      expect(replace).toHaveBeenCalledExactlyOnceWith("/signin");
    });
  });

  describe("サインアウト", () => {
    it("確認すると、この端末のセッションだけを終え、遷移元を付けずにサインインへ移る", async () => {
      // Given
      const user = userEvent.setup();
      signOutClearingSession(async () => ({ error: null }));
      renderPageWithIdentity();

      // When
      await confirmSignOut(user);

      // Then
      expect(supabase.signOut).toHaveBeenCalledExactlyOnceWith({
        scope: "local",
      });
      expect(replace).toHaveBeenCalledExactlyOnceWith("/signin");
      // 完了は遷移で画面ごと捨てられるため、遷移まで実行中の表示のまま変えない。
      expect(screen.getByText(authText("signOutConfirm"))).toBeInTheDocument();
    });

    it("認証サービスが拒否しても、その後の読み取りが未認証なら、エラーを示さず、完了として遷移元を付けずに移る", async () => {
      // Given
      const user = userEvent.setup();
      signOutClearingSession(async () => ({ error: RATE_LIMIT_ERROR }));
      renderPageWithIdentity();

      // When
      await confirmSignOut(user);

      // Then
      expect(replace).toHaveBeenCalledExactlyOnceWith("/signin");
      // 完了は遷移で画面ごと捨てられるため、遷移まで実行中の表示のまま変えない。
      expect(screen.getByText(authText("signOutConfirm"))).toBeInTheDocument();
      expect(
        screen.queryByText(authText("failure.rate_limited")),
      ).not.toBeInTheDocument();
    });

    it("失敗の後に別の理由でセッションを失ったときは、開いていた画面を遷移元に付けて移る", async () => {
      // Given
      const user = userEvent.setup();
      supabase.signOut.mockResolvedValue({ error: RATE_LIMIT_ERROR });
      renderPage();
      await confirmSignOut(user);
      await screen.findByText(authText("failure.rate_limited"));

      // When
      act(() => supabase.emit("SIGNED_OUT", null));

      // Then
      expect(replace).toHaveBeenCalledExactlyOnceWith(
        "/signin?returnTo=%2Fsettings",
      );
    });

    it("再描画を挟まない同じタスクで2回確認しても、認証は1回である", async () => {
      // Given
      const user = userEvent.setup();
      supabase.signOut.mockReturnValue(new Promise(() => {}));
      renderPage();
      await user.click(signOutButton());
      const confirm = screen.getByTestId("confirm-dialog-confirm");

      // When
      act(() => {
        fireEvent.click(confirm);
        fireEvent.click(confirm);
      });

      // Then
      expect(supabase.signOut).toHaveBeenCalledTimes(1);
    });
  });
});
