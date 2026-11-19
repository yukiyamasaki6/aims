import { type ReactNode, useState } from "react";
import { createSession } from "@/features/auth/application/session";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
import { createBrowserPageLoad } from "@/features/auth/infrastructure/browser-page-load";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { SessionProvider } from "@/features/auth/ui/session-context";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import { createClient } from "@/lib/supabase/infrastructure/client";

import "fake-indexeddb/auto";
import { render, screen } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
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

function routeOf(view: SettingsView | null): SettingsRoute {
  return {
    view,
    closeFocus: "opener",
    open: vi.fn(),
    move: vi.fn(),
    close: vi.fn(),
  };
}

const deleteAccount: DeleteAccount = {
  submit: vi.fn(async () => {}),
  sendCode: vi.fn(async () => {}),
  verifyCode: vi.fn(async () => {}),
  tickCooldown: vi.fn(() => () => {}),
};

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
    it.each([
      ["email", "changeEmailTitle"],
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

    it.each(["email", "delete-account"] as const)(
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
  });
});
