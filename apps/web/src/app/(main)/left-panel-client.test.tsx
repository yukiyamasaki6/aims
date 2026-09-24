import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeftPanelClient } from "./left-panel-client";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
}));

const auth = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: auth.signOut } }),
}));

const identity = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("@/features/auth/local-identity", () => ({
  getLocalIdentity: () => identity.value,
}));

beforeEach(() => {
  vi.clearAllMocks();
  identity.value = null;
});

describe("LeftPanelClient", () => {
  it("shows the サインアウト button when signed in", () => {
    render(<LeftPanelClient isSignedIn={true} />);
    expect(
      screen.getByRole("button", { name: "サインアウト" }),
    ).toBeInTheDocument();
  });

  it("hides the サインアウト button when signed out", () => {
    render(<LeftPanelClient isSignedIn={false} />);
    expect(
      screen.queryByRole("button", { name: "サインアウト" }),
    ).not.toBeInTheDocument();
  });

  it("opens the mobile menu overlay when the hamburger button is clicked", async () => {
    const user = userEvent.setup();
    render(<LeftPanelClient isSignedIn={false} />);

    // 閉じるボタン（X）は常時DOM上に存在するため、開いた後に増える
    // オーバーレイの分だけ件数が増えることで開閉を判定する。
    const closeButtonsBefore = screen.getAllByRole("button", {
      name: "メニューを閉じる",
    });
    expect(closeButtonsBefore).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "メニューを開く" }));

    expect(
      screen.getAllByRole("button", { name: "メニューを閉じる" }),
    ).toHaveLength(2);
  });

  it("collapses the desktop panel when the collapse button is clicked", async () => {
    const user = userEvent.setup();
    render(<LeftPanelClient isSignedIn={false} />);

    await user.click(screen.getByRole("button", { name: "パネルを格納する" }));

    expect(
      screen.getByRole("button", { name: "パネルを開く" }),
    ).toBeInTheDocument();
  });

  it("オフラインでサインアウトのネットワーク呼び出しが失敗しても、ローカルセッションが削除されたら/へ遷移する", async () => {
    const user = userEvent.setup();
    // signOut自体はオフラインでのネットワークエラーを返す想定。しかし
    // SupabaseのSDKはscope:"local"の場合、ネットワーク成否に関わらず
    // ローカルセッションを削除しSIGNED_OUTを発火する
    // （GoTrueClient._removeSessionの実挙動）。UIは`getLocalIdentity()`
    // （onAuthStateChangeのSIGNED_OUTで別途更新される）を遷移の根拠にすべきで、
    // signOut()の戻り値のerrorだけを見て「失敗した」と判断してはならない。
    auth.signOut.mockResolvedValue({
      error: { message: "network error", status: undefined },
    });
    identity.value = null;

    render(<LeftPanelClient isSignedIn={true} />);

    await user.click(screen.getByRole("button", { name: "サインアウト" }));
    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => {
      expect(nav.push).toHaveBeenCalledWith("/");
    });
  });

  it("本当にサインアウトが失敗した場合（ローカルの識別情報が消えない）はエラー表示のまま遷移しない", async () => {
    const user = userEvent.setup();
    auth.signOut.mockResolvedValue({
      error: { message: "invalid session", status: 401, name: "AuthApiError" },
    });
    identity.value = "user-1";

    render(<LeftPanelClient isSignedIn={true} />);

    await user.click(screen.getByRole("button", { name: "サインアウト" }));
    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    // ローカルの識別情報が消えていない＝本当の失敗ケース。
    // この場合はエラー文言のまま留まり遷移しない。
    await waitFor(() => {
      expect(screen.getByText("invalid session")).toBeInTheDocument();
    });
    expect(nav.push).not.toHaveBeenCalled();
  });
});
