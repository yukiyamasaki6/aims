import { AuthApiError } from "@supabase/supabase-js";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { ROUNDS_PATH } from "@/routes";
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
vi.mock("../round-base-refresher", () => ({ RoundBaseRefresher: () => null }));
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

const replace = vi.fn();
const assign = vi.fn();
const IDENTITY_KEY = "aims:local-user-id";
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

async function confirmSignOut(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: authText("signOut") }));
  await user.click(screen.getByTestId("confirm-dialog-confirm"));
}

function renderLayout() {
  return render(
    <MainLayout>
      <p>子要素</p>
    </MainLayout>,
    { wrapper: IntlTestProvider },
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
    it("左パネルのサインアウトの操作と子要素を並べて表示する", () => {
      // Given
      // When
      renderLayout();

      // Then
      expect(screen.getByRole("complementary")).toContainElement(
        screen.getByRole("button", { name: authText("signOut") }),
      );
      expect(screen.getByText("子要素")).toBeInTheDocument();
    });

    it("左パネルの個人リンクは、一覧の経路を向く", () => {
      // Given
      // When
      renderLayout();

      // Then
      expect(
        screen.getByRole("link", { name: navigationText("leftPanelPersonal") }),
      ).toHaveAttribute("href", ROUNDS_PATH);
    });

    it("Supabaseの環境変数が無くても、描画時に接続を作らず描画できる", () => {
      // Given
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

      // When
      const render = () =>
        renderToString(
          <IntlTestProvider>
            <MainLayout>
              <p>子要素</p>
            </MainLayout>
          </IntlTestProvider>,
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

    it("マウントの後、確認の前に環境変数が失われたときは、通信エラーを示してダイアログを開いたままボタンを戻す", async () => {
      // Given
      const user = userEvent.setup();
      renderLayoutWithIdentity();
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
      renderLayoutWithIdentity();
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

  describe("サインアウト", () => {
    it("確認すると、この端末のセッションだけを終え、遷移元を付けずにサインインへ移る", async () => {
      // Given
      const user = userEvent.setup();
      signOutClearingSession(async () => ({ error: null }));
      renderLayoutWithIdentity();

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
      renderLayoutWithIdentity();

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
      renderLayout();
      await confirmSignOut(user);
      await screen.findByText(authText("failure.rate_limited"));

      // When
      act(() => supabase.emit("SIGNED_OUT", null));

      // Then
      expect(replace).toHaveBeenCalledExactlyOnceWith(
        "/signin?returnTo=%2Frounds%2Fnew",
      );
    });

    it("再描画を挟まない同じタスクで2回確認しても、認証は1回である", async () => {
      // Given
      const user = userEvent.setup();
      supabase.signOut.mockReturnValue(new Promise(() => {}));
      renderLayout();
      await user.click(
        screen.getByRole("button", { name: authText("signOut") }),
      );
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
