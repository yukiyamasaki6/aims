import type { AuthError } from "@supabase/supabase-js";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initLocalIdentity } from "@/features/auth/local-identity";
import { createClient } from "@/lib/supabase/client";
import { LeftPanelClient } from "./left-panel-client";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
}));

// SupabaseのSDKは外部サービスとの境界のため、signOutの結果と認証状態の変化（onAuthStateChange）を任意に制御できるスタブで模す。
const supabase = vi.hoisted(() => {
  const listeners: Array<
    (event: string, session: { user: { id: string } } | null) => void
  > = [];
  return {
    listeners,
    signOut: vi.fn(),
    emit(event: string, session: { user: { id: string } } | null) {
      for (const listener of listeners) listener(event, session);
    },
  };
});
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: {
      signOut: supabase.signOut,
      onAuthStateChange: (listener: (typeof supabase.listeners)[number]) => {
        supabase.listeners.push(listener);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  }),
}));

// SDKのsignOut({ scope: "local" })は、サーバー通信の成否に関わらずローカルセッションを削除できた場合にSIGNED_OUTを発火する。その挙動をスタブで再現する。
function signOutRemovingLocalSession(result: () => Promise<unknown>) {
  supabase.signOut.mockImplementation(async () => {
    supabase.emit("SIGNED_OUT", null);
    return result();
  });
}

function makeAuthError(fields: Partial<AuthError>): AuthError {
  return { message: "x", ...fields } as AuthError;
}

async function confirmSignOut(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "サインアウト" }));
  await user.click(screen.getByTestId("confirm-dialog-confirm"));
}

// 次のマクロタスクまで進め、その時点までに積まれたマイクロタスクを、実装の非同期処理の段数によらず全て処理する。
// 「まだ起きていないこと」は条件が満たされるまで待つ形では確かめられないため、これで進めてから検証する。
async function flushToMacrotask() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function closeMenuButtons() {
  return screen.getAllByRole("button", { name: "メニューを閉じる" });
}

let disposeLocalIdentity: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  supabase.listeners.length = 0;
  localStorage.clear();
  // 端末ローカルの識別情報はルートレイアウトと同様にinitLocalIdentityで認証状態の変化へ追従させ、この端末にuser-1がサインイン済みの状態から始める。
  disposeLocalIdentity = initLocalIdentity(createClient());
  supabase.emit("SIGNED_IN", { user: { id: "user-1" } });
});

afterEach(() => {
  disposeLocalIdentity();
});

describe("LeftPanelClient", () => {
  describe("サインアウトボタン", () => {
    it("サインイン済みの場合は表示する", () => {
      // Given
      // When
      render(<LeftPanelClient isSignedIn={true} />);

      // Then
      expect(
        screen.getByRole("button", { name: "サインアウト" }),
      ).toBeInTheDocument();
    });

    it("未サインインの場合は表示しない", () => {
      // Given
      // When
      render(<LeftPanelClient isSignedIn={false} />);

      // Then
      expect(
        screen.queryByRole("button", { name: "サインアウト" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("リンク", () => {
    it("AIMSリンクと個人リンクは/roundsへのリンクである", () => {
      // Given
      // When
      render(<LeftPanelClient isSignedIn={true} />);

      // Then
      expect(screen.getByRole("link", { name: "AIMS" })).toHaveAttribute(
        "href",
        "/rounds",
      );
      expect(screen.getByRole("link", { name: "個人" })).toHaveAttribute(
        "href",
        "/rounds",
      );
    });
  });

  describe("サインアウトを確認する", () => {
    it("サインアウトが完了した場合は、/へ遷移する", async () => {
      // Given
      const user = userEvent.setup();
      signOutRemovingLocalSession(async () => ({ error: null }));
      render(<LeftPanelClient isSignedIn={true} />);

      // When
      await confirmSignOut(user);

      // Then
      await waitFor(() => {
        expect(nav.push).toHaveBeenCalledWith("/");
      });
    });

    it("サインアウトに失敗した場合は、エラーを表示し遷移しない", async () => {
      // Given
      const user = userEvent.setup();
      supabase.signOut.mockResolvedValue({
        error: makeAuthError({ code: "over_request_rate_limit" }),
      });
      render(<LeftPanelClient isSignedIn={true} />);

      // When
      await confirmSignOut(user);

      // Then
      expect(
        await screen.findByText(
          "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
        ),
      ).toBeInTheDocument();
      expect(nav.push).not.toHaveBeenCalled();
    });

    it("サインアウトの完了前にアンマウントされた場合は遷移しない", async () => {
      // Given
      const user = userEvent.setup();
      let completeSignOut: () => void = () => {};
      const pendingSignOut = new Promise<{ error: null }>((resolve) => {
        completeSignOut = () => {
          supabase.emit("SIGNED_OUT", null);
          resolve({ error: null });
        };
      });
      supabase.signOut.mockReturnValue(pendingSignOut);
      const { unmount } = render(<LeftPanelClient isSignedIn={true} />);
      await confirmSignOut(user);

      // When
      unmount();
      completeSignOut();
      await flushToMacrotask();

      // Then
      expect(nav.push).not.toHaveBeenCalled();
    });
  });

  describe("モバイルメニュー", () => {
    // 閉じるボタン（X）は常時DOM上に存在するため、開いている間だけ表示される背景の閉じるボタンの分だけ件数が増えることで開閉を判定する。
    it("開くボタンを押すと、背景を含めて開く", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanelClient isSignedIn={false} />);

      // When
      await user.click(screen.getByRole("button", { name: "メニューを開く" }));

      // Then
      expect(closeMenuButtons()).toHaveLength(2);
    });

    it("背景を押すと閉じる", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanelClient isSignedIn={false} />);
      await user.click(screen.getByRole("button", { name: "メニューを開く" }));

      // When
      // 背景はパネルより前にDOMへ配置される。
      await user.click(closeMenuButtons()[0]);

      // Then
      expect(closeMenuButtons()).toHaveLength(1);
    });

    it("パネル内の閉じるボタンを押すと閉じる", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanelClient isSignedIn={false} />);
      await user.click(screen.getByRole("button", { name: "メニューを開く" }));

      // When
      await user.click(closeMenuButtons()[1]);

      // Then
      expect(closeMenuButtons()).toHaveLength(1);
    });
  });

  describe("デスクトップパネル", () => {
    it("格納ボタンを押すと格納する", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanelClient isSignedIn={false} />);

      // When
      await user.click(
        screen.getByRole("button", { name: "パネルを格納する" }),
      );

      // Then
      expect(
        screen.getByRole("button", { name: "パネルを開く" }),
      ).toBeInTheDocument();
    });

    it("格納後に開くボタンを押すと再び開く", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanelClient isSignedIn={false} />);
      await user.click(
        screen.getByRole("button", { name: "パネルを格納する" }),
      );

      // When
      await user.click(screen.getByRole("button", { name: "パネルを開く" }));

      // Then
      expect(
        screen.getByRole("button", { name: "パネルを格納する" }),
      ).toBeInTheDocument();
    });
  });
});
