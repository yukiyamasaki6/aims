import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type RoundListItem, RoundsListClient } from "./rounds-list-client";

const db = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: db.getSession },
    rpc: db.rpc,
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

beforeEach(() => {
  vi.clearAllMocks();
  db.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-1" } } },
  });
  db.rpc.mockResolvedValue({ error: null });
});

describe("RoundsListClient", () => {
  it("削除を確定すると、認証確認後にdisable_roundを実行し一覧から取り除く", async () => {
    const user = userEvent.setup();
    render(<RoundsListClient initialRounds={rounds} />);

    await openDeleteDialog(user, "午前練習");
    expect(
      screen.getByText(
        "「午前練習」を削除しますか？記録したスコアもすべて失われます。",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => {
      expect(db.rpc).toHaveBeenCalledWith("disable_round", {
        p_round_event_id: expect.any(String),
        p_round_id: "round-1",
      });
    });
    await waitFor(() => {
      expect(screen.queryByText("午前練習")).not.toBeInTheDocument();
    });
    expect(screen.getByText("午後練習")).toBeInTheDocument();
  });

  it("未認証の場合はRPCを呼ばずエラーを表示する", async () => {
    db.getSession.mockResolvedValue({ data: { session: null } });
    const user = userEvent.setup();
    render(<RoundsListClient initialRounds={rounds} />);

    await openDeleteDialog(user, "午前練習");
    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    expect(
      await screen.findByText("サインインが必要です。"),
    ).toBeInTheDocument();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(screen.getByText("午前練習")).toBeInTheDocument();
  });

  it("RPCが失敗した場合はエラーを表示し、一覧からは取り除かない", async () => {
    db.rpc.mockResolvedValue({ error: { message: "権限がありません。" } });
    const user = userEvent.setup();
    render(<RoundsListClient initialRounds={rounds} />);

    await openDeleteDialog(user, "午前練習");
    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    expect(await screen.findByText("権限がありません。")).toBeInTheDocument();
    expect(screen.getByText("午前練習")).toBeInTheDocument();
  });

  it("通信エラー(例外)の場合は汎用エラーを表示する", async () => {
    db.getSession.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    render(<RoundsListClient initialRounds={rounds} />);

    await openDeleteDialog(user, "午前練習");
    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    expect(
      await screen.findByText(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("午前練習")).toBeInTheDocument();
  });

  it("キャンセルすると削除確認を閉じ、何も送信しない", async () => {
    const user = userEvent.setup();
    render(<RoundsListClient initialRounds={rounds} />);

    await openDeleteDialog(user, "午前練習");
    await user.click(screen.getByTestId("confirm-dialog-cancel"));

    expect(
      screen.queryByText(
        "「午前練習」を削除しますか？記録したスコアもすべて失われます。",
      ),
    ).not.toBeInTheDocument();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(screen.getByText("午前練習")).toBeInTheDocument();
  });

  it("セッション確認中にアンマウントされた場合、disable_roundを呼ばない", async () => {
    let resolveSession: (value: {
      data: { session: { user: { id: string } } | null };
    }) => void = () => {};
    db.getSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );
    const user = userEvent.setup();
    const { unmount } = render(<RoundsListClient initialRounds={rounds} />);

    await openDeleteDialog(user, "午前練習");
    await user.click(screen.getByTestId("confirm-dialog-confirm"));
    unmount();

    resolveSession({ data: { session: { user: { id: "user-1" } } } });
    await Promise.resolve();
    await Promise.resolve();

    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("ラウンドが1件も無い場合は空状態メッセージを表示する", () => {
    render(<RoundsListClient initialRounds={[]} />);

    expect(screen.getByText("まだラウンドがありません。")).toBeInTheDocument();
  });
});
