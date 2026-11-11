import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import type { LoadedRoundsList, RoundListItem } from "../domain/round-list";
import {
  createFakeRoundProcedures,
  createFakeRoundsListStore,
  createFakeRoundWindow,
} from "./round-stores-test-helpers";
import {
  RoundProceduresProvider,
  RoundsListStoreProvider,
  RoundWindowProvider,
} from "./rounds-context";
import { RoundsHistory } from "./rounds-history";

const roundsText = translatorFor("rounds");

// 取得、端末の列、削除の実物はそれぞれのテストで確かめる。ここでは偽の約束で渡す。
let fake: ReturnType<typeof createFakeRoundsListStore>;
let fakeWindow: ReturnType<typeof createFakeRoundWindow>;
let procedures: ReturnType<typeof createFakeRoundProcedures>;

function loaded(
  items: RoundListItem[],
  overrides: Partial<LoadedRoundsList> = {},
): LoadedRoundsList {
  return { items, deleted: new Set(), ...overrides };
}

function renderHistory() {
  return render(
    <RoundWindowProvider roundWindow={fakeWindow.roundWindow}>
      <RoundsListStoreProvider store={fake.store}>
        <RoundProceduresProvider procedures={procedures}>
          <RoundsHistory />
        </RoundProceduresProvider>
      </RoundsListStoreProvider>
    </RoundWindowProvider>,
    { wrapper: IntlTestProvider },
  );
}

const completed: RoundListItem[] = [
  { id: "round-1", name: "午前練習", roundDate: "2026-09-15", total: 300 },
  { id: "round-2", name: "午後練習", roundDate: "2026-09-16", total: 280 },
];

function fetchResolves(items: RoundListItem[]) {
  fake.store.loadList.mockResolvedValue({
    status: "ok",
    data: loaded(items),
  });
}

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
  fake = createFakeRoundsListStore();
  procedures = createFakeRoundProcedures();
  // offlineの結果が返る状況は通信が切れている(切れていないと、すぐ再取得する)。
  procedures.goOffline();
  fakeWindow = createFakeRoundWindow();
  fakeWindow.setLocal({ inProgress: [] });
});

describe("RoundsHistory", () => {
  describe("履歴の表示", () => {
    it("表示を始めると履歴を1回取得し、取得できた完了のラウンドをカードで表示する", async () => {
      // Given
      fetchResolves(completed);

      // When
      renderHistory();

      // Then
      expect(await screen.findByText("午前練習")).toBeInTheDocument();
      expect(fake.store.loadList).toHaveBeenCalledExactlyOnceWith();
      expect(screen.getByText("午後練習")).toBeInTheDocument();
      expect(screen.getByText("2026-09-15")).toBeInTheDocument();
      expect(
        screen.getByText(roundsText("roundTotalPoints", { total: "300" })),
      ).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("新規作成ボタンと見出しを持たない", async () => {
      // Given
      fetchResolves(completed);

      // When
      renderHistory();
      await screen.findByText("午前練習");

      // Then
      expect(screen.queryByTestId("new-round-fab")).toBeNull();
      expect(screen.queryByRole("heading")).toBeNull();
    });

    it("完了したラウンドが0件なら、その旨を表示する", async () => {
      // Given
      fetchResolves([]);

      // When
      renderHistory();

      // Then
      expect(
        await screen.findByText(roundsText("historyEmpty")),
      ).toBeInTheDocument();
    });

    it("端末の入力中のラウンドと同じIDのラウンドは表示しない", async () => {
      // Given
      fakeWindow.setLocal({ inProgress: [completed[0]] });
      fetchResolves(completed);

      // When
      renderHistory();

      // Then
      expect(await screen.findByText("午後練習")).toBeInTheDocument();
      expect(screen.queryByText("午前練習")).not.toBeInTheDocument();
    });

    it("取得時に求めた削除済みのラウンドは表示しない", async () => {
      // Given
      fake.store.loadList.mockResolvedValue({
        status: "ok",
        data: loaded(completed, { deleted: new Set(["round-1"]) }),
      });

      // When
      renderHistory();

      // Then
      expect(await screen.findByText("午後練習")).toBeInTheDocument();
      expect(screen.queryByText("午前練習")).not.toBeInTheDocument();
    });
  });

  describe("取得の状態", () => {
    it("取得中は、読み込み中の表示を出し、ラウンドも空の表示も出さない", () => {
      // Given
      fake.store.loadList.mockReturnValue(new Promise(() => {}));

      // When
      renderHistory();

      // Then
      expect(screen.getByRole("status")).toHaveTextContent(
        roundsText("fetchLoading"),
      );
      expect(screen.queryByRole("listitem")).toBeNull();
      expect(screen.queryByText(roundsText("historyEmpty"))).toBeNull();
    });

    it("取得が成功しても、端末の入力中をまだ読んでいなければ、読み込み中の表示を出す", () => {
      // Given
      fetchResolves(completed);
      fakeWindow.roundWindow.localList.mockReturnValue(null);

      // When
      renderHistory();

      // Then
      expect(screen.getByRole("status")).toHaveTextContent(
        roundsText("fetchLoading"),
      );
      expect(screen.queryByRole("listitem")).toBeNull();
    });

    it("通信できない場合は、ネットワークに接続されていないことを履歴の中に表示し、ラウンドも空の表示も出さない", async () => {
      // Given
      fake.store.loadList.mockResolvedValue({ status: "offline" });
      fakeWindow.setLocal({ inProgress: [completed[0]] });

      // When
      renderHistory();

      // Then
      expect(
        await screen.findByText(roundsText("fetchOffline")),
      ).toBeInTheDocument();
      expect(screen.queryByRole("listitem")).toBeNull();
      expect(screen.queryByText(roundsText("historyEmpty"))).toBeNull();
    });

    it("取得がエラーの場合は、エラーメッセージを表示し、ラウンドも空の表示も出さない", async () => {
      // Given
      fake.store.loadList.mockResolvedValue({
        status: "error",
        reason: "failed",
      });

      // When
      renderHistory();

      // Then
      expect(await screen.findByRole("alert")).toHaveTextContent(
        roundsText("fetchFailure.failed"),
      );
      expect(screen.queryByRole("listitem")).toBeNull();
      expect(screen.queryByText(roundsText("historyEmpty"))).toBeNull();
    });

    it("オフラインの結果の後に通信が戻ると、取得し直し、取得できた履歴を表示する", async () => {
      // Given
      fake.store.loadList
        .mockResolvedValueOnce({ status: "offline" })
        .mockResolvedValueOnce({ status: "ok", data: loaded(completed) });
      renderHistory();
      await screen.findByText(roundsText("fetchOffline"));

      // When
      await act(async () => procedures.returnOnline());

      // Then
      expect(await screen.findByText("午前練習")).toBeInTheDocument();
      expect(fake.store.loadList).toHaveBeenCalledTimes(2);
    });

    it("再試行すると取得し直し、取得できた履歴を表示する", async () => {
      // Given
      fake.store.loadList
        .mockResolvedValueOnce({ status: "offline" })
        .mockResolvedValueOnce({ status: "ok", data: loaded(completed) });
      const user = userEvent.setup();
      renderHistory();
      const retry = await screen.findByRole("button", {
        name: roundsText("fetchRetry"),
      });

      // When
      await user.click(retry);

      // Then
      expect(await screen.findByText("午前練習")).toBeInTheDocument();
      expect(fake.store.loadList).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByText(roundsText("fetchOffline")),
      ).not.toBeInTheDocument();
    });
  });

  describe("ラウンドの削除", () => {
    it("確認すると、そのラウンドを削除し、ダイアログがすぐ閉じ、履歴から取り除く", async () => {
      // Given
      // 削除の保存は終わらない。
      procedures.deletion.deleteRound.mockReturnValue(new Promise(() => {}));
      fetchResolves(completed);
      const user = userEvent.setup();
      renderHistory();
      await screen.findByText("午前練習");
      await openDeleteDialog(user, "午前練習");
      expect(
        screen.getByText(
          roundsText("roundDeleteConfirmNamed", { name: "午前練習" }),
        ),
      ).toBeInTheDocument();

      // When
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then
      expect(procedures.deletion.deleteRound).toHaveBeenCalledExactlyOnceWith(
        "round-1",
      );
      await waitFor(() => {
        expect(screen.queryByText("午前練習")).not.toBeInTheDocument();
      });
      expect(screen.getByText("午後練習")).toBeInTheDocument();
      expect(screen.queryByTestId("confirm-dialog-confirm")).toBeNull();
    });

    it("キャンセルすると削除確認を閉じ、削除せず、履歴に残す", async () => {
      // Given
      fetchResolves(completed);
      const user = userEvent.setup();
      renderHistory();
      await screen.findByText("午前練習");
      await openDeleteDialog(user, "午前練習");

      // When
      await user.click(screen.getByTestId("confirm-dialog-cancel"));

      // Then
      await waitFor(() => {
        expect(screen.queryByTestId("confirm-dialog-cancel")).toBeNull();
      });
      expect(procedures.deletion.deleteRound).not.toHaveBeenCalled();
      expect(screen.getByText("午前練習")).toBeInTheDocument();
    });

    it("削除したラウンドは、再試行で取得が変わっても表示しない", async () => {
      // Given
      fake.store.loadList
        .mockResolvedValueOnce({ status: "ok", data: loaded(completed) })
        .mockResolvedValueOnce({ status: "offline" })
        .mockResolvedValueOnce({ status: "ok", data: loaded(completed) });
      const user = userEvent.setup();
      renderHistory();
      await screen.findByText("午前練習");
      await openDeleteDialog(user, "午前練習");
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // When
      await act(async () => procedures.returnOnline());

      // Then
      expect(await screen.findByText("午後練習")).toBeInTheDocument();
      expect(screen.queryByText("午前練習")).toBeNull();
    });
  });
});
