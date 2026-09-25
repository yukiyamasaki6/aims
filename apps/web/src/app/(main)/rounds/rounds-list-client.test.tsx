import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type RoundListItem, RoundsListClient } from "./rounds-list-client";

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

const rounds: RoundListItem[] = [
  { id: "round-1", name: "午前練習", roundDate: "2026-09-15", total: 300 },
  { id: "round-2", name: "午後練習", roundDate: "2026-09-16", total: 280 },
];

async function openDeleteDialog(
  user: ReturnType<typeof userEvent.setup>,
  roundName: string,
) {
  const item = screen.getByText(roundName).closest("li");
  if (!item) throw new Error(`round item not found: ${roundName}`);
  await user.click(within(item).getByTestId("round-menu-trigger"));
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

describe("RoundsListClient", () => {
  describe("一覧の表示", () => {
    it("ラウンドが1件も無い場合は空状態メッセージを表示する", () => {
      // Given: ラウンドが無い
      // When: 一覧を表示する
      render(<RoundsListClient initialRounds={[]} />);

      // Then: 空状態メッセージを表示する
      expect(
        screen.getByText("まだラウンドがありません。"),
      ).toBeInTheDocument();
    });
  });

  describe("ラウンドの削除", () => {
    it("確認すると、そのラウンドのdisable_roundを実行し、一覧から取り除く", async () => {
      // Given: 2件のラウンドを表示し、1件目の削除確認を開いている
      const user = userEvent.setup();
      render(<RoundsListClient initialRounds={rounds} />);
      await openDeleteDialog(user, "午前練習");
      expect(
        screen.getByText(
          "「午前練習」を削除しますか？記録したスコアもすべて失われます。",
        ),
      ).toBeInTheDocument();

      // When: 削除を確認する
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then: そのラウンドのdisable_roundを実行し、そのラウンドだけを一覧から取り除く
      await waitFor(() => {
        expect(screen.queryByText("午前練習")).not.toBeInTheDocument();
      });
      expect(supabase.rpc).toHaveBeenCalledWith("disable_round", {
        p_round_event_id: expect.any(String),
        p_round_id: "round-1",
      });
      expect(screen.getByText("午後練習")).toBeInTheDocument();
    });

    it("キャンセルすると削除確認を閉じ、何も送信しない", async () => {
      // Given: 削除確認を開いている
      const user = userEvent.setup();
      render(<RoundsListClient initialRounds={rounds} />);
      await openDeleteDialog(user, "午前練習");

      // When: キャンセルする
      await user.click(screen.getByTestId("confirm-dialog-cancel"));
      await flushToMacrotask();

      // Then: 削除確認を閉じ、disable_roundを呼ばず、一覧に残す
      expect(
        screen.queryByText(
          "「午前練習」を削除しますか？記録したスコアもすべて失われます。",
        ),
      ).not.toBeInTheDocument();
      expect(supabase.rpc).not.toHaveBeenCalled();
      expect(screen.getByText("午前練習")).toBeInTheDocument();
    });

    it("削除できなかった場合はエラーを表示し、一覧からは取り除かない", async () => {
      // Given: disable_roundがエラーを返す状態で、削除確認を開いている
      supabase.rpc.mockResolvedValue({
        data: null,
        error: { message: "権限がありません。" },
      });
      const user = userEvent.setup();
      render(<RoundsListClient initialRounds={rounds} />);
      await openDeleteDialog(user, "午前練習");

      // When: 削除を確認する
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then: エラーを表示し、一覧に残す
      expect(await screen.findByText("権限がありません。")).toBeInTheDocument();
      expect(screen.getByText("午前練習")).toBeInTheDocument();
    });

    it("セッション確認中にアンマウントされた場合、disable_roundを呼ばない", async () => {
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
      const { unmount } = render(<RoundsListClient initialRounds={rounds} />);
      await openDeleteDialog(user, "午前練習");
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // When: アンマウントしてから、セッションの確認が完了する
      unmount();
      resolveSession({ data: { session: { user: { id: "user-1" } } } });
      await flushToMacrotask();

      // Then: disable_roundを呼ばない
      expect(supabase.rpc).not.toHaveBeenCalled();
    });
  });
});
