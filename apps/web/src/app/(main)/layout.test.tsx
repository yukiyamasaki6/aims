import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalIdentityProvider } from "../local-identity-provider";
import MainLayout from "./layout";

// 入口のテスト。SDK(@supabase/ssr)と、ブラウザの保存先(localStorage)・場所(location)・通信の可否(navigator.onLine)の境界だけを差し替え、
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
    emit(event: string, session: { user: { id: string } } | null) {
      for (const listener of listeners) listener(event, session);
    },
  };
});
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
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
  }),
}));

const replace = vi.fn();
const assign = vi.fn();
const IDENTITY_KEY = "aims:local-user-id";
const NETWORK_ERROR =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";
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

// SDKのsignOut({ scope: "local" })は、通信の成否に関わらずローカルのセッションを削除できた場合にSIGNED_OUTを発火する。
// 端末の識別情報は直接消さず、ルートの購読(LocalIdentityProvider。renderLayoutWithIdentityで実物を描く)がこの出来事で消す。
function signOutEmittingSignedOut(result: () => Promise<unknown>) {
  supabase.signOut.mockImplementation(async () => {
    supabase.emit("SIGNED_OUT", null);
    return result();
  });
}

async function confirmSignOut(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "サインアウト" }));
  await user.click(screen.getByTestId("confirm-dialog-confirm"));
}

function renderLayout() {
  return render(
    <MainLayout>
      <p>子要素</p>
    </MainLayout>,
  );
}

// ルートの識別情報の記録(実物)と合わせて描く。識別情報の消去は、この購読が担う。
function renderLayoutWithIdentity() {
  return render(
    <>
      <LocalIdentityProvider />
      <MainLayout>
        <p>子要素</p>
      </MainLayout>
    </>,
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
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
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
        screen.getByRole("button", { name: "サインアウト" }),
      );
      expect(screen.getByText("子要素")).toBeInTheDocument();
    });

    it("Supabaseの環境変数が無くても、描画時に接続を作らず描画できる", () => {
      // Given
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

      // When
      const render = () =>
        renderToString(
          <MainLayout>
            <p>子要素</p>
          </MainLayout>,
        );

      // Then
      expect(render).not.toThrow();
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

    it("他のタブなどでsigned-outを受けると、開いている画面を遷移元に付けて、ページ全体を置き換えてサインインへ移る", () => {
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

    it("ラウンド一覧では、遷移元を付けない", () => {
      // Given
      setLocation("/rounds");
      renderLayout();

      // When
      supabase.emit("SIGNED_OUT", null);

      // Then
      expect(replace).toHaveBeenCalledExactlyOnceWith("/signin");
    });

    it("入力が重なっても、遷移は1回である", () => {
      // Given
      renderLayout();

      // When
      supabase.emit("SIGNED_OUT", null);
      supabase.emit("SIGNED_OUT", null);

      // Then
      expect(replace).toHaveBeenCalledTimes(1);
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

    it("オフラインで未認証と判っても、移動せず留まる", async () => {
      // Given
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      supabase.getSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      // When
      renderLayout();
      await flush();

      // Then
      expect(replace).not.toHaveBeenCalled();
      expect(supabase.getSession).not.toHaveBeenCalled();
    });

    it("離れると、購読を解除し、それ以降のsigned-outでは移らない", () => {
      // Given
      const { unmount } = renderLayout();

      // When
      unmount();

      // Then
      expect(supabase.unsubscribe).toHaveBeenCalledTimes(1);
      expect(supabase.listeners).toHaveLength(0);
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
      signOutEmittingSignedOut(async () => ({ error: null }));
      renderLayoutWithIdentity();

      // When
      await confirmSignOut(user);

      // Then
      expect(supabase.signOut).toHaveBeenCalledExactlyOnceWith({
        scope: "local",
      });
      expect(replace).toHaveBeenCalledExactlyOnceWith("/signin");
      await waitFor(() => {
        expect(
          screen.queryByText("サインアウトしますか？"),
        ).not.toBeInTheDocument();
      });
    });

    it("認証サービスが通信の失敗を返してもローカルのセッションが消えていれば、完了として移る", async () => {
      // Given
      const user = userEvent.setup();
      signOutEmittingSignedOut(async () => ({
        error: new AuthRetryableFetchError("Failed to fetch", 0),
      }));
      renderLayoutWithIdentity();

      // When
      await confirmSignOut(user);

      // Then
      expect(localStorage.getItem(IDENTITY_KEY)).toBeNull();
      expect(replace).toHaveBeenCalledExactlyOnceWith("/signin");
      await waitFor(() => {
        expect(
          screen.queryByText("サインアウトしますか？"),
        ).not.toBeInTheDocument();
      });
      expect(screen.queryByText(NETWORK_ERROR)).not.toBeInTheDocument();
    });

    it("通信が例外になってもローカルのセッションが消えていれば、完了として移る", async () => {
      // Given
      const user = userEvent.setup();
      signOutEmittingSignedOut(async () => {
        throw new TypeError("Failed to fetch");
      });
      renderLayoutWithIdentity();

      // When
      await confirmSignOut(user);

      // Then
      expect(localStorage.getItem(IDENTITY_KEY)).toBeNull();
      expect(replace).toHaveBeenCalledExactlyOnceWith("/signin");
      await waitFor(() => {
        expect(
          screen.queryByText("サインアウトしますか？"),
        ).not.toBeInTheDocument();
      });
      expect(screen.queryByText(NETWORK_ERROR)).not.toBeInTheDocument();
    });

    it("ルートの識別情報の記録と合わせて、サインアウトで端末の識別情報が消え、完了として移る", async () => {
      // Given
      const user = userEvent.setup();
      supabase.signOut.mockImplementation(async () => {
        supabase.emit("SIGNED_OUT", null);
        return { error: null };
      });
      renderLayoutWithIdentity();

      // When
      await confirmSignOut(user);

      // Then
      expect(localStorage.getItem(IDENTITY_KEY)).toBeNull();
      expect(replace).toHaveBeenCalledExactlyOnceWith("/signin");
      await waitFor(() => {
        expect(
          screen.queryByText("サインアウトしますか？"),
        ).not.toBeInTheDocument();
      });
    });

    it("認証サービスが拒否して端末の識別情報が残ったときは、理由を示し、閉じずに移らない", async () => {
      // Given
      const user = userEvent.setup();
      supabase.signOut.mockResolvedValue({ error: RATE_LIMIT_ERROR });
      renderLayout();

      // When
      await confirmSignOut(user);

      // Then
      expect(
        await screen.findByText(
          "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("サインアウトしますか？")).toBeInTheDocument();
      expect(replace).not.toHaveBeenCalled();
    });

    // 現行の挙動(要件の既知の論点1)。保存先が使えない環境では識別情報が常に空として読まれるため、実際には失敗していても完了と判定する。構造の組み直しでは変えない。
    it("保存先が使えず識別情報が読めない環境では、サインアウトが失敗しても完了と判定し、ダイアログを閉じる", async () => {
      // Given
      const user = userEvent.setup();
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });
      supabase.signOut.mockResolvedValue({ error: RATE_LIMIT_ERROR });
      renderLayout();

      // When
      await confirmSignOut(user);

      // Then
      await waitFor(() => {
        expect(
          screen.queryByText("サインアウトしますか？"),
        ).not.toBeInTheDocument();
      });
      expect(replace).not.toHaveBeenCalled();
    });

    it("例外で端末の識別情報が残ったときは、通信エラーを示す", async () => {
      // Given
      const user = userEvent.setup();
      supabase.signOut.mockRejectedValue(new TypeError("Failed to fetch"));
      renderLayout();

      // When
      await confirmSignOut(user);

      // Then
      expect(
        await screen.findByText(
          "通信エラーが発生しました。しばらくしてから再度お試しください。",
        ),
      ).toBeInTheDocument();
      expect(replace).not.toHaveBeenCalled();
    });

    it("失敗の後に別の理由でセッションを失ったときは、開いていた画面を遷移元に付けて移る", async () => {
      // Given
      const user = userEvent.setup();
      supabase.signOut.mockResolvedValue({ error: RATE_LIMIT_ERROR });
      renderLayout();
      await confirmSignOut(user);
      await screen.findByText(
        "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
      );

      // When
      act(() => supabase.emit("SIGNED_OUT", null));

      // Then
      expect(replace).toHaveBeenCalledExactlyOnceWith(
        "/signin?returnTo=%2Frounds%2Fnew",
      );
    });

    it("失敗の後に再度確認して完了すれば、遷移元を付けずに移る", async () => {
      // Given
      const user = userEvent.setup();
      supabase.signOut.mockResolvedValueOnce({ error: RATE_LIMIT_ERROR });
      renderLayoutWithIdentity();
      await confirmSignOut(user);
      await screen.findByText(
        "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
      );
      signOutEmittingSignedOut(async () => ({ error: null }));

      // When
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then
      expect(replace).toHaveBeenCalledExactlyOnceWith("/signin");
    });

    it("再描画を挟まない同じタスクで2回確認しても、認証は1回である", async () => {
      // Given
      const user = userEvent.setup();
      supabase.signOut.mockReturnValue(new Promise(() => {}));
      renderLayout();
      await user.click(screen.getByRole("button", { name: "サインアウト" }));
      const confirm = screen.getByTestId("confirm-dialog-confirm");

      // When
      act(() => {
        fireEvent.click(confirm);
        fireEvent.click(confirm);
      });

      // Then
      expect(supabase.signOut).toHaveBeenCalledTimes(1);
    });

    it("完了を待つ間に画面が離れたときは、端末の識別情報を読まず、結果を破棄する", async () => {
      // Given
      const user = userEvent.setup();
      let finish: (value: unknown) => void = () => {};
      supabase.signOut.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const { unmount } = renderLayout();
      await confirmSignOut(user);
      const getItem = vi.spyOn(Storage.prototype, "getItem");
      unmount();

      // When
      await act(async () => finish({ error: RATE_LIMIT_ERROR }));

      // Then
      expect(getItem).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
    });
  });
});
