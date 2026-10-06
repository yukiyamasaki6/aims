import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchResult } from "@/features/fetch-result/fetch-result";
import type { RoundListItem } from "./fetch-rounds-list";
import { type LoadedRoundsList, loadRoundsList } from "./load-rounds-list";
import { RoundsListClient } from "./rounds-list-client";

// 一覧の読み込みは別のテストで確かめるため、境界としてモックする。
vi.mock("./load-rounds-list", () => ({ loadRoundsList: vi.fn() }));
const load = vi.mocked(loadRoundsList);

// 削除は列への入り口の先で行うため、境界としてモックする。
const deletion = vi.hoisted(() => ({ deleteRound: vi.fn() }));
vi.mock("./_shared/delete-round", () => deletion);

// 反映済みの除去は、ラウンドごとの送信器へ渡る。
const sync = vi.hoisted(() => ({ reflect: vi.fn(), round: vi.fn() }));
vi.mock("./_shared/round-op-log", () => ({
  roundOpLog: { round: sync.round },
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

function loaded(
  items: RoundListItem[],
  overrides: Partial<LoadedRoundsList> = {},
): LoadedRoundsList {
  return { items, deleted: new Set(), reflected: [], ...overrides };
}

function fetchResolves(result: FetchResult<RoundListItem[]>) {
  load.mockResolvedValue(
    result.status === "ok"
      ? { status: "ok", data: loaded(result.data) }
      : result,
  );
}

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
  deletion.deleteRound.mockResolvedValue(undefined);
  sync.round.mockReturnValue({ reflect: sync.reflect });
});

describe("RoundsListClient", () => {
  describe("一覧の表示", () => {
    it("取得中は、読み込み中の表示と新規作成ボタンを表示する", () => {
      // Given: 取得が完了しない
      load.mockReturnValue(new Promise(() => {}));

      // When: 一覧を表示する
      render(<RoundsListClient />);

      // Then: 読み込み中の表示と新規作成ボタンを表示し、空状態は表示しない
      expect(screen.getByRole("status")).toHaveTextContent("読み込み中");
      expect(screen.getByTestId("new-round-fab")).toBeInTheDocument();
      expect(
        screen.queryByText("まだラウンドがありません。"),
      ).not.toBeInTheDocument();
    });

    it("取得できたラウンドをカードで表示し、新規作成ボタンも表示する", async () => {
      // Given: 2件のラウンドを取得できる
      fetchResolves({ status: "ok", data: rounds });

      // When: 一覧を表示する
      render(<RoundsListClient />);

      // Then: 各ラウンドの名前、日付、合計点を表示する
      expect(await screen.findByText("午前練習")).toBeInTheDocument();
      expect(screen.getByText("2026-09-15")).toBeInTheDocument();
      expect(screen.getByText("300点")).toBeInTheDocument();
      expect(screen.getByText("午後練習")).toBeInTheDocument();
      expect(screen.getByTestId("new-round-fab")).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("ラウンドが0件の場合は空状態メッセージを表示する", async () => {
      // Given: ラウンドが0件で取得できる
      fetchResolves({ status: "ok", data: [] });

      // When: 一覧を表示する
      render(<RoundsListClient />);

      // Then: 空状態メッセージと新規作成ボタンを表示する
      expect(
        await screen.findByText("まだラウンドがありません。"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("new-round-fab")).toBeInTheDocument();
    });

    it("通信できない場合はネットワークに接続されていませんを表示し、空状態は表示せず、新規作成ボタンは表示する", async () => {
      // Given: 通信できない
      fetchResolves({ status: "offline" });

      // When: 一覧を表示する
      render(<RoundsListClient />);

      // Then: ネットワークに接続されていませんと新規作成ボタンを表示し、空状態は表示しない
      expect(
        await screen.findByText("ネットワークに接続されていません"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("new-round-fab")).toBeInTheDocument();
      expect(
        screen.queryByText("まだラウンドがありません。"),
      ).not.toBeInTheDocument();
    });

    it("取得がエラーの場合はエラーメッセージを表示し、空状態は表示せず、新規作成ボタンは表示する", async () => {
      // Given: 取得がエラーになる
      fetchResolves({ status: "error", message: "読み込めませんでした。" });

      // When: 一覧を表示する
      render(<RoundsListClient />);

      // Then: エラーメッセージと新規作成ボタンを表示し、空状態は表示しない
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "読み込めませんでした。",
      );
      expect(screen.getByTestId("new-round-fab")).toBeInTheDocument();
      expect(
        screen.queryByText("まだラウンドがありません。"),
      ).not.toBeInTheDocument();
    });

    it("再試行すると取得し直し、取得できた一覧を表示する", async () => {
      // Given: 1回目は通信できず、2回目は取得できる
      load
        .mockResolvedValueOnce({ status: "offline" })
        .mockResolvedValueOnce({ status: "ok", data: loaded(rounds) });
      const user = userEvent.setup();
      render(<RoundsListClient />);
      await user.click(await screen.findByRole("button", { name: "再試行" }));

      // Then: 取得し直して一覧を表示する
      expect(await screen.findByText("午前練習")).toBeInTheDocument();
      expect(load).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByText("ネットワークに接続されていません"),
      ).not.toBeInTheDocument();
    });
  });

  describe("端末の列", () => {
    it("列で削除済みのラウンドを表示しない", async () => {
      // Given: 取得結果に、端末の列で削除済みのラウンドがある
      load.mockResolvedValue({
        status: "ok",
        data: loaded(rounds, { deleted: new Set(["round-1"]) }),
      });

      // When
      render(<RoundsListClient />);

      // Then
      expect(await screen.findByText("午後練習")).toBeInTheDocument();
      expect(screen.queryByText("午前練習")).not.toBeInTheDocument();
    });

    it("反映済みと確かめた操作を、そのラウンドの送信器から外す", async () => {
      // Given
      load.mockResolvedValue({
        status: "ok",
        data: loaded(rounds, {
          deleted: new Set(["round-1"]),
          reflected: [{ roundId: "round-1", eventIds: ["e1", "e2"] }],
        }),
      });

      // When
      render(<RoundsListClient />);
      await screen.findByText("午後練習");

      // Then
      expect(sync.round).toHaveBeenCalledWith("round-1");
      expect(sync.reflect).toHaveBeenCalledWith(["e1", "e2"]);
    });
  });

  describe("ラウンドの削除", () => {
    it("確認すると、そのラウンドを削除し、ダイアログがすぐ閉じ、一覧から取り除く", async () => {
      // Given: 2件のラウンドを表示し、1件目の削除確認を開いている。削除の保存は終わらない
      deletion.deleteRound.mockReturnValue(new Promise(() => {}));
      const user = userEvent.setup();
      fetchResolves({ status: "ok", data: rounds });
      render(<RoundsListClient />);
      await screen.findByText("午前練習");
      await openDeleteDialog(user, "午前練習");
      expect(
        screen.getByText(
          "「午前練習」を削除しますか？記録したスコアもすべて失われます。",
        ),
      ).toBeInTheDocument();

      // When: 削除を確認する
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then: そのラウンドを削除し、そのラウンドだけが一覧から消え、ダイアログは閉じ、スピナーとエラーは出ない
      expect(deletion.deleteRound).toHaveBeenCalledWith("round-1");
      await waitFor(() => {
        expect(screen.queryByText("午前練習")).not.toBeInTheDocument();
      });
      expect(screen.getByText("午後練習")).toBeInTheDocument();
      expect(screen.queryByTestId("confirm-dialog-confirm")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("キャンセルすると削除確認を閉じ、削除せず、一覧に残す", async () => {
      // Given: 削除確認を開いている
      const user = userEvent.setup();
      fetchResolves({ status: "ok", data: rounds });
      render(<RoundsListClient />);
      await screen.findByText("午前練習");
      await openDeleteDialog(user, "午前練習");

      // When: キャンセルする
      await user.click(screen.getByTestId("confirm-dialog-cancel"));

      // Then
      await waitFor(() => {
        expect(screen.queryByTestId("confirm-dialog-cancel")).toBeNull();
      });
      expect(deletion.deleteRound).not.toHaveBeenCalled();
      expect(screen.getByText("午前練習")).toBeInTheDocument();
    });
  });
});
