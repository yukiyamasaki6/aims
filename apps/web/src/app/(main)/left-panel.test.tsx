import type { AuthError } from "@supabase/supabase-js";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initLocalIdentity } from "@/features/auth/local-identity";
import { createClient } from "@/lib/supabase/client";
import { LeftPanel } from "./left-panel";

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

function wideToggle() {
  return screen.getByTestId("left-panel-toggle-wide");
}

function compactToggle() {
  return screen.getByTestId("left-panel-toggle-compact");
}

function panel() {
  return screen.getByRole("complementary");
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

describe("LeftPanel", () => {
  describe("サインアウトボタン", () => {
    it("表示する", () => {
      // Given
      // When
      render(<LeftPanel />);

      // Then
      expect(
        screen.getByRole("button", { name: "サインアウト" }),
      ).toBeInTheDocument();
    });
  });

  describe("リンク", () => {
    it("AIMSリンクは/へ、個人リンクは/roundsへのリンクである", () => {
      // Given
      // When
      render(<LeftPanel />);

      // Then
      expect(screen.getByRole("link", { name: "AIMS" })).toHaveAttribute(
        "href",
        "/",
      );
      expect(screen.getByRole("link", { name: "個人" })).toHaveAttribute(
        "href",
        "/rounds",
      );
    });
  });

  describe("サインアウトを確認する", () => {
    it("サインアウトが完了した場合は、確認ダイアログを閉じる", async () => {
      // Given
      const user = userEvent.setup();
      signOutRemovingLocalSession(async () => ({ error: null }));
      render(<LeftPanel />);

      // When
      await confirmSignOut(user);

      // Then
      await waitFor(() => {
        expect(
          screen.queryByTestId("confirm-dialog-confirm"),
        ).not.toBeInTheDocument();
      });
    });

    it("サインアウトに失敗した場合は、エラーを表示する", async () => {
      // Given
      const user = userEvent.setup();
      supabase.signOut.mockResolvedValue({
        error: makeAuthError({ code: "over_request_rate_limit" }),
      });
      render(<LeftPanel />);

      // When
      await confirmSignOut(user);

      // Then
      expect(
        await screen.findByText(
          "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("モバイルメニュー", () => {
    // 閉じるボタン（X）は常時DOM上に存在するため、開いている間だけ表示される背景の閉じるボタンの分だけ件数が増えることで開閉を判定する。
    it("開くボタンを押すと、背景を含めて開く", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel />);

      // When
      await user.click(screen.getByRole("button", { name: "メニューを開く" }));

      // Then
      expect(closeMenuButtons()).toHaveLength(2);
    });

    it("背景を押すと閉じる", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel />);
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
      render(<LeftPanel />);
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
      render(<LeftPanel />);

      // When
      await user.click(wideToggle());

      // Then
      expect(wideToggle()).toHaveAccessibleName("パネルを開く");
    });

    it("格納後に開くボタンを押すと再び開く", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel />);
      await user.click(wideToggle());

      // When
      await user.click(wideToggle());

      // Then
      expect(wideToggle()).toHaveAccessibleName("パネルを格納する");
    });
  });

  // jsdomはCSSを評価しないため、表示の切替（向きと幅）はE2Eで確かめる。ここでは共有される開閉の状態と、2つの開閉ボタンの表示を確かめる。
  describe("開閉の状態の共有", () => {
    it("操作前は、広い用が格納する、横向きかつ狭い用が開くで、ドロワーの背景は出ない", () => {
      // Given
      // When
      render(<LeftPanel />);

      // Then
      expect(wideToggle()).toHaveAccessibleName("パネルを格納する");
      expect(compactToggle()).toHaveAccessibleName("パネルを開く");
      expect(closeMenuButtons()).toHaveLength(1);
    });

    it("広い用で格納すると、両方のボタンが開くになる。続けて展開すると両方が格納するになり、ドロワーが開く", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel />);

      // When
      await user.click(wideToggle());

      // Then
      expect(wideToggle()).toHaveAccessibleName("パネルを開く");
      expect(compactToggle()).toHaveAccessibleName("パネルを開く");
      expect(closeMenuButtons()).toHaveLength(1);

      // When
      await user.click(wideToggle());

      // Then
      expect(wideToggle()).toHaveAccessibleName("パネルを格納する");
      expect(compactToggle()).toHaveAccessibleName("パネルを格納する");
      expect(closeMenuButtons()).toHaveLength(2);
    });

    it("横向きかつ狭い用で展開すると、広い用も格納するになる。背景を押すと両方が開くになる", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel />);

      // When
      await user.click(compactToggle());

      // Then
      expect(wideToggle()).toHaveAccessibleName("パネルを格納する");
      expect(closeMenuButtons()).toHaveLength(2);

      // When
      await user.click(closeMenuButtons()[0]);

      // Then
      expect(wideToggle()).toHaveAccessibleName("パネルを開く");
      expect(compactToggle()).toHaveAccessibleName("パネルを開く");
      expect(closeMenuButtons()).toHaveLength(1);
    });

    it("ハンバーガーでドロワーを開くと、両方のボタンが格納するになる", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel />);

      // When
      await user.click(screen.getByRole("button", { name: "メニューを開く" }));

      // Then
      expect(wideToggle()).toHaveAccessibleName("パネルを格納する");
      expect(compactToggle()).toHaveAccessibleName("パネルを格納する");
    });
  });

  describe("開閉のtransition", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("初回表示ではtransitionが付かない", () => {
      // Given
      // When
      render(<LeftPanel />);

      // Then
      expect(panel()).not.toHaveClass("duration-200");
    });

    it("操作の直後は付き、250ms後に外れる", async () => {
      // Given
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LeftPanel />);

      // When
      await user.click(wideToggle());

      // Then
      expect(panel()).toHaveClass("duration-200");

      // When
      act(() => {
        vi.advanceTimersByTime(250);
      });

      // Then
      expect(panel()).not.toHaveClass("duration-200");
    });

    it("100ms間隔の2回の操作では、最初の操作から200ms後もまだ付いている", async () => {
      // Given
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LeftPanel />);
      await user.click(wideToggle());
      act(() => {
        vi.advanceTimersByTime(100);
      });
      await user.click(wideToggle());

      // When
      act(() => {
        vi.advanceTimersByTime(200);
      });

      // Then
      expect(panel()).toHaveClass("duration-200");
    });
  });
});
