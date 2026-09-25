import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoundMenu } from "./round-menu";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

// SupabaseのSDKは外部サービスとの境界のため、セッションの取得結果とRPCの結果を任意に制御できるスタブで模す。
// 削除の操作は、実物のSupabaseクライアントラッパーを通してこのスタブに届く。
const supabase = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: { getSession: supabase.getSession },
    rpc: supabase.rpc,
  }),
}));

async function openDeleteConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("round-menu-trigger"));
  await user.click(await screen.findByTestId("round-delete"));
}

// 次のマクロタスクまで進め、その時点までに積まれたマイクロタスクを、実装の非同期処理の段数によらず全て処理する。
// 「まだ起きていないこと」は条件が満たされるまで待つ形では確かめられないため、これで進めてから検証する。
async function flushToMacrotask() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-1" } } },
  });
  supabase.rpc.mockResolvedValue({ data: null, error: null });
});

describe("RoundMenu", () => {
  describe("ラウンドの削除", () => {
    it("確認すると、そのラウンドのdisable_roundを実行し、一覧へ遷移する", async () => {
      // Given: 削除確認を開いている
      const user = userEvent.setup();
      render(<RoundMenu roundId="round-1" />);
      await openDeleteConfirm(user);
      expect(
        screen.getByText(
          "このラウンドを削除しますか？記録したスコアもすべて失われます。",
        ),
      ).toBeInTheDocument();

      // When: 削除を確認する
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then: そのラウンドのdisable_roundを実行し、一覧へ遷移する
      await waitFor(() => {
        expect(nav.push).toHaveBeenCalledWith("/rounds");
      });
      expect(supabase.rpc).toHaveBeenCalledWith("disable_round", {
        p_round_event_id: expect.any(String),
        p_round_id: "round-1",
      });
    });

    it("削除できなかった場合はエラーを表示し、遷移しない", async () => {
      // Given: disable_roundがエラーを返す状態で、削除確認を開いている
      supabase.rpc.mockResolvedValue({
        data: null,
        error: { message: "権限がありません。" },
      });
      const user = userEvent.setup();
      render(<RoundMenu roundId="round-1" />);
      await openDeleteConfirm(user);

      // When: 削除を確認する
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then: エラーを表示し、遷移しない
      expect(await screen.findByText("権限がありません。")).toBeInTheDocument();
      expect(nav.push).not.toHaveBeenCalled();
    });

    it("セッション確認中にアンマウントされた場合、disable_roundを呼ばず遷移しない", async () => {
      // Given: セッションの確認が完了しないまま、削除を確認している
      let resolveSession: (value: {
        data: { session: { user: { id: string } } | null };
      }) => void = () => {};
      supabase.getSession.mockReturnValue(
        new Promise((resolve) => {
          resolveSession = resolve;
        }),
      );
      const user = userEvent.setup();
      const { unmount } = render(<RoundMenu roundId="round-1" />);
      await openDeleteConfirm(user);
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // When: アンマウントしてから、セッションの確認が完了する
      unmount();
      resolveSession({ data: { session: { user: { id: "user-1" } } } });
      await flushToMacrotask();

      // Then: disable_roundを呼ばず、遷移しない
      expect(supabase.rpc).not.toHaveBeenCalled();
      expect(nav.push).not.toHaveBeenCalled();
    });
  });
});
