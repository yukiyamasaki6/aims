import { type ReactNode, useState } from "react";
import { createSession } from "@/features/auth/application/session";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
import { createBrowserPageLoad } from "@/features/auth/infrastructure/browser-page-load";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import {
  SessionProvider,
  useSession,
} from "@/features/auth/ui/session-context";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import { createClient } from "@/lib/supabase/infrastructure/client";

import "fake-indexeddb/auto";
import { AuthApiError } from "@supabase/supabase-js";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useEffect, useImperativeHandle } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeleteAccount } from "@/features/auth/application/delete-account";
import { DeleteAccountProvider } from "@/features/auth/ui/delete-account-context";
import type { SettingsView } from "@/features/settings/domain/settings-location";
import type { SettingsRoute } from "@/features/settings/ui/use-settings-route";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import {
  type FakeViewport,
  installFakeViewport,
} from "@/lib/viewport/fake-viewport-test-helpers";
import { RootClientEntry } from "../root-client-entry";
import { SettingsPanelEntry } from "./settings-panel-entry";

const authText = translatorFor("auth");

// 入口のテスト。SDK(@supabase/ssr)と、ブラウザの保存先(localStorage)・場所(location)の境界だけを差し替え、
// 手続き、実装、画面、確認ダイアログ、設定パネルは実物を通す。
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
    updateUser: vi.fn(),
    verifyOtp: vi.fn(),
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
      updateUser: supabase.updateUser,
      verifyOtp: supabase.verifyOtp,
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

// セキュリティチェックは外部のウィジェットのため、トークンを発行できる代役に差し替える。
const widget = vi.hoisted(() => ({
  onVerify: undefined as ((token: string | null) => void) | undefined,
  siteKey: undefined as string | undefined,
}));
vi.mock("@/features/auth/ui/turnstile", () => ({
  Turnstile: forwardRef<
    unknown,
    { siteKey: string; onVerify: (token: string | null) => void }
  >(function TurnstileStub({ siteKey, onVerify }, ref) {
    widget.onVerify = onVerify;
    widget.siteKey = siteKey;
    useImperativeHandle(ref, () => ({ reset: () => {} }));
    return null;
  }),
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
const NETWORK_ERROR = authText("failure.unreachable");
const RATE_LIMIT_ERROR = new AuthApiError(
  "limit",
  429,
  "over_request_rate_limit",
);

function setLocation(pathname: string, search = "", hash = "") {
  vi.stubGlobal("location", {
    href: `http://localhost${pathname}${search}${hash}`,
    origin: "http://localhost",
    replace,
    assign,
    pathname,
    search,
    hash,
  });
}

// SDKのsignOut({ scope: "local" })は、通信の成否に関わらずローカルのセッションを削除できた場合にSIGNED_OUTを発火し、以後のgetSessionはセッションを返さない。
// 端末の識別情報は直接消さず、ルートの購読(RootClientEntry。renderWithIdentityで実物を描く)がこの出来事で消す。
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

// セッション喪失の見張り。本番では(main)のレイアウトが始める。
function SessionWatch() {
  const session = useSession();
  useEffect(() => session.watch(), [session]);
  return null;
}

function routeOf(view: SettingsView | null): SettingsRoute {
  return {
    view,
    closeFocus: "opener",
    open: vi.fn(),
    move: vi.fn(),
    close: vi.fn(),
  };
}

const deleteAccount: DeleteAccount = { submit: vi.fn(async () => {}) };

function entry(view: SettingsView) {
  return <SettingsPanelEntry route={routeOf(view)} />;
}

// 設定パネルの入口を、削除の手続きの提供の下に描く。
function renderEntry(view: SettingsView) {
  return render(
    <DeleteAccountProvider deleteAccount={deleteAccount}>
      {entry(view)}
    </DeleteAccountProvider>,
    { wrapper: SessionWrapper },
  );
}

// ルートの識別情報の記録(実物)と合わせて描く。識別情報の消去は、この購読が担う。
function renderWithIdentity(view: SettingsView) {
  return render(<RootClientEntry>{entry(view)}</RootClientEntry>, {
    wrapper: IntlTestProvider,
  });
}

function signOutButton() {
  return screen.getByRole("button", { name: authText("signOut") });
}

async function confirmSignOut(user: ReturnType<typeof userEvent.setup>) {
  await user.click(signOutButton());
  await user.click(screen.getByTestId("confirm-dialog-confirm"));
}

// jsdomにmatchMediaが無いため、入口の表示領域の補償が読む名前を、タブ(補償しない)の偽物で差す。
let viewport: FakeViewport;

beforeEach(() => {
  vi.clearAllMocks();
  viewport = installFakeViewport();
  supabase.listeners.length = 0;
  widget.onVerify = undefined;
  widget.siteKey = undefined;
  localStorage.clear();
  localStorage.setItem(IDENTITY_KEY, "user-1");
  supabase.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-1" } } },
    error: null,
  });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  setLocation("/rounds");
});

afterEach(() => {
  viewport.restore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("SettingsPanelEntry", () => {
  describe("表示", () => {
    it("分類の表示に、サインアウトの行を1つ表示する", () => {
      // Given
      // When
      renderEntry("account");

      // Then
      expect(
        screen.getAllByRole("button", { name: authText("signOut") }),
      ).toHaveLength(1);
    });

    it.each([
      ["email", "changeEmailTitle"],
      ["password", "changePasswordTitle"],
      ["delete-account", "deleteAccountTitle"],
    ] as const)(
      "%sの表示では、項目の画面の見出し(%s)を表示し、サインアウトの行は表示しない",
      (view, title) => {
        // Given
        // When
        renderEntry(view);

        // Then
        expect(
          screen.getByRole("heading", { name: authText(title) }),
        ).toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: authText("signOut") }),
        ).toBeNull();
      },
    );

    it("表示が変わると、画面ごと作り直し、前の入力値を持ち越さず、空から描く", async () => {
      // Given
      const user = userEvent.setup();
      const { rerender } = renderEntry("password");
      await user.type(
        screen.getByPlaceholderText(
          authText("changePasswordCurrentPlaceholder"),
        ),
        "password-original1",
      );

      rerender(
        <DeleteAccountProvider deleteAccount={deleteAccount}>
          {entry("email")}
        </DeleteAccountProvider>,
      );

      // When
      rerender(
        <DeleteAccountProvider deleteAccount={deleteAccount}>
          {entry("password")}
        </DeleteAccountProvider>,
      );

      // Then
      expect(
        screen.getByPlaceholderText(
          authText("changePasswordCurrentPlaceholder"),
        ),
      ).toHaveValue("");
    });

    it.each(["email", "password", "delete-account"] as const)(
      "セキュリティチェックのサイトキーの環境変数が無くても、%sの画面を例外を投げずに描く",
      (view) => {
        // Given
        vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", undefined);

        // When
        const render = () => renderEntry(view);

        // Then
        expect(render).not.toThrow();
      },
    );

    it("Supabaseの環境変数が無くても、描画時に接続を作らず描画できる", () => {
      // Given
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

      // When
      const render = () =>
        renderToString(
          <SessionWrapper>
            <DeleteAccountProvider deleteAccount={deleteAccount}>
              {entry("account")}
            </DeleteAccountProvider>
          </SessionWrapper>,
        );

      // Then
      expect(render).not.toThrow();
    });

    it("診断を有効にしていた端末(旧キーの保存あり)で開いても、バッジは表示されず、サインアウトのボタンが表示され、エラーにならない", () => {
      // Given
      // 削除済みの機能が端末に残した実在の値。以後は参照されないことを確かめるため、このテストだけ旧キーと旧testidの文字列を書く。
      localStorage.setItem("aims:viewport-diagnostics", "1");

      // When
      const render = () => renderWithIdentity("account");

      // Then
      expect(render).not.toThrow();
      expect(screen.queryByTestId("viewport-diagnostics-badge")).toBeNull();
      expect(
        screen.getAllByRole("button", { name: authText("signOut") }),
      ).toHaveLength(1);
    });
  });

  describe("メールアドレス変更", () => {
    it("新しい宛先を送ると、入口が得た接続で、変更の要求を頼む", async () => {
      // Given
      supabase.updateUser.mockResolvedValue({
        data: { user: { email: "current@example.com" } },
        error: null,
      });
      const user = userEvent.setup();
      renderEntry("email");
      await user.type(
        screen.getByPlaceholderText(authText("changeEmailNewPlaceholder")),
        "new@example.com",
      );

      // When
      await user.click(
        screen.getByRole("button", { name: authText("otpSendCode") }),
      );

      // Then
      expect(
        await screen.findByLabelText(
          authText("changeEmailNewCodeLabel", { email: "new@example.com" }),
        ),
      ).toBeVisible();
      expect(supabase.updateUser).toHaveBeenCalledExactlyOnceWith({
        email: "new@example.com",
      });
    });
  });

  describe("パスワード変更", () => {
    async function submitPassword(
      user: ReturnType<typeof userEvent.setup>,
      current = "password-original1",
    ) {
      await user.type(
        screen.getByPlaceholderText(
          authText("changePasswordCurrentPlaceholder"),
        ),
        current,
      );
      await user.type(
        screen.getByPlaceholderText(authText("changePasswordNewPlaceholder")),
        "password-changed1",
      );
      await user.click(
        screen.getByRole("button", { name: authText("changePasswordSubmit") }),
      );
    }

    it("送信すると、入口が得た接続で、現在のパスワードと新しいパスワードの更新を頼む", async () => {
      // Given
      supabase.updateUser.mockResolvedValue({ error: null });
      const user = userEvent.setup();
      renderEntry("password");

      // When
      await submitPassword(user);

      // Then
      expect(
        await screen.findByText(authText("changePasswordDone")),
      ).toBeVisible();
      expect(supabase.updateUser).toHaveBeenCalledExactlyOnceWith({
        password: "password-changed1",
        current_password: "password-original1",
      });
    });

    it("認証サービスが現在のパスワードの誤りで拒否すると、その文言を表示し、入力値を保つ", async () => {
      // Given
      supabase.updateUser.mockResolvedValue({
        error: new AuthApiError("wrong", 400, "current_password_invalid"),
      });
      const user = userEvent.setup();
      renderEntry("password");

      // When
      await submitPassword(user, "password-wrong1");

      // Then
      expect(
        await screen.findByText(authText("failure.current_password_invalid")),
      ).toBeVisible();
      expect(
        screen.getByPlaceholderText(
          authText("changePasswordCurrentPlaceholder"),
        ),
      ).toHaveValue("password-wrong1");
    });

    it("端末がオフラインなら、認証サービスへ送らず、オフラインの文言を表示する", async () => {
      // Given
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      const user = userEvent.setup();
      renderEntry("password");

      // When
      await submitPassword(user);

      // Then
      expect(
        await screen.findByText(authText("failure.offline")),
      ).toBeVisible();
      expect(supabase.updateUser).not.toHaveBeenCalled();
    });
  });

  describe("アカウント削除", () => {
    it("入力したパスワードで、入口が受け取った手続きに削除を頼む", async () => {
      // Given
      const user = userEvent.setup();
      renderEntry("delete-account");
      await user.type(
        screen.getByPlaceholderText(
          authText("deleteAccountPasswordPlaceholder"),
        ),
        "password-current1",
      );
      act(() => widget.onVerify?.("captcha-token"));

      // When
      await user.click(
        screen.getByRole("button", { name: authText("deleteAccountSubmit") }),
      );

      // Then
      expect(deleteAccount.submit).toHaveBeenCalledOnce();
      expect(vi.mocked(deleteAccount.submit).mock.calls[0][0]).toEqual({
        password: "password-current1",
      });
    });

    it("セキュリティチェックのサイトキーの環境変数を、チェックへ渡す。無ければ空にする", () => {
      // Given
      vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key-1");
      const withKey = renderEntry("delete-account");
      const keyed = widget.siteKey;
      withKey.unmount();
      vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", undefined);

      // When
      renderEntry("delete-account");

      // Then
      expect(keyed).toBe("site-key-1");
      expect(widget.siteKey).toBe("");
    });

    it("手続きの提供が無いと、投げる", () => {
      // Given
      vi.spyOn(console, "error").mockImplementation(() => {});

      // When
      const renderWithout = () =>
        render(entry("delete-account"), { wrapper: SessionWrapper });

      // Then
      expect(renderWithout).toThrow();
    });
  });

  describe("キーボード操作", () => {
    it("Tabでサインアウトのボタンへフォーカスが届く", async () => {
      // Given
      const user = userEvent.setup();
      renderEntry("account");
      const button = signOutButton();

      // When
      for (let i = 0; i < 30 && document.activeElement !== button; i++)
        await user.tab();

      // Then
      expect(button).toHaveFocus();
    });

    it("サインアウトのボタンにフォーカスがあるとき、Enterで確認のダイアログが開く", async () => {
      // Given
      const user = userEvent.setup();
      renderEntry("account");
      signOutButton().focus();

      // When
      await user.keyboard("{Enter}");

      // Then
      expect(screen.getByText(authText("signOutConfirm"))).toBeInTheDocument();
    });
  });

  // 環境変数の欠落のうち、依頼時の欠落を扱う。事前描画は「表示」で扱う。
  describe("環境変数の欠落", () => {
    function loseEnv() {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    }

    it("マウントの後、確認の前に環境変数が失われたときは、通信エラーを示してダイアログを開いたままボタンを戻す", async () => {
      // Given
      const user = userEvent.setup();
      renderWithIdentity("account");
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
      renderWithIdentity("account");
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
      renderWithIdentity("account");

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
      renderWithIdentity("account");

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

    it("失敗の後に別の理由でセッションを失ったときは、開いていた画面(設定パネルのハッシュを含む)を遷移元に付けて移る", async () => {
      // Given
      setLocation("/rounds/history", "", "#settings/account");
      const user = userEvent.setup();
      supabase.signOut.mockResolvedValue({ error: RATE_LIMIT_ERROR });
      render(
        <>
          <SessionWatch />
          {entry("account")}
        </>,
        { wrapper: SessionWrapper },
      );
      await confirmSignOut(user);
      await screen.findByText(authText("failure.rate_limited"));

      // When
      act(() => supabase.emit("SIGNED_OUT", null));

      // Then
      expect(replace).toHaveBeenCalledExactlyOnceWith(
        "/signin?returnTo=%2Frounds%2Fhistory%23settings%2Faccount",
      );
    });

    it("再描画を挟まない同じタスクで2回確認しても、認証は1回である", async () => {
      // Given
      const user = userEvent.setup();
      supabase.signOut.mockReturnValue(new Promise(() => {}));
      renderEntry("account");
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
