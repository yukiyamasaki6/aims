import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { NEW_ROUND_PATH, roundPath } from "@/routes";
import type { FetchResult } from "../domain/fetch-status";
import type {
  LoadedRoundsList,
  LocalRoundsList,
  RoundListItem,
} from "../domain/round-list";
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
import { RoundsList } from "./rounds-list";

const roundsText = translatorFor("rounds");

// ラウンドの状態と変更の方法は、一覧の読み込み、削除、端末の列、待ちの合図だけを持つ偽の約束で渡す。
// 取得、端末の列、削除の実物はそれぞれのテストで確かめる。
let fake: ReturnType<typeof createFakeRoundsListStore>;
let fakeWindow: ReturnType<typeof createFakeRoundWindow>;
let load: ReturnType<typeof createFakeRoundsListStore>["store"]["loadList"];
let procedures: ReturnType<typeof createFakeRoundProcedures>;
let deleteRound: ReturnType<
  typeof createFakeRoundProcedures
>["deletion"]["deleteRound"];

function loaded(
  items: RoundListItem[],
  overrides: Partial<LoadedRoundsList> = {},
): LoadedRoundsList {
  return { items, deleted: new Set(), ...overrides };
}

function renderList() {
  return render(
    <RoundWindowProvider roundWindow={fakeWindow.roundWindow}>
      <RoundsListStoreProvider store={fake.store}>
        <RoundProceduresProvider procedures={procedures}>
          <RoundsList />
        </RoundProceduresProvider>
      </RoundsListStoreProvider>
    </RoundWindowProvider>,
    { wrapper: IntlTestProvider },
  );
}

// 端末の入力中のラウンドの読み込み結果を設定する。
function setLocal(local: LocalRoundsList) {
  fakeWindow.setLocal(local);
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

const roundsWithUnnamed: RoundListItem[] = [
  rounds[0],
  { id: "round-9", name: "", roundDate: "2026-09-17", total: 100 },
];

async function openMenu(
  user: ReturnType<typeof userEvent.setup>,
  roundDate: string,
) {
  const item = screen.getByText(roundDate).closest("li");
  if (!item) throw new Error(`round item not found: ${roundDate}`);
  await user.click(within(item).getByTestId("round-menu-trigger"));
}

const inProgressRounds: RoundListItem[] = [
  { id: "round-3", name: "入力中の練習", roundDate: "2026-09-10", total: 120 },
];

function offlineWithLocal(items: RoundListItem[] = inProgressRounds) {
  setLocal({ inProgress: items });
}

beforeEach(() => {
  fake = createFakeRoundsListStore();
  procedures = createFakeRoundProcedures();
  // offlineの結果が返る状況は通信が切れている(切れていないと、すぐ再取得する)。
  procedures.goOffline();
  // 端末の列は、既定では入力中のラウンドが無い。
  fakeWindow = createFakeRoundWindow();
  fakeWindow.setLocal({ inProgress: [] });
  load = fake.store.loadList;
  deleteRound = procedures.deletion.deleteRound;
});

describe("RoundsList", () => {
  describe("一覧の表示", () => {
    it("取得中は、読み込み中の表示と新規作成ボタンを表示する", () => {
      // Given
      load.mockReturnValue(new Promise(() => {}));

      // When
      renderList();

      // Then
      expect(screen.getByRole("status")).toHaveTextContent(
        roundsText("fetchLoading"),
      );
      expect(screen.getByTestId("new-round-fab")).toBeInTheDocument();
      expect(
        screen.queryByText(roundsText("listEmpty")),
      ).not.toBeInTheDocument();
    });

    it("取得できたラウンドをカードで表示し、新規作成ボタンも表示する", async () => {
      // Given
      fetchResolves({ status: "ok", data: rounds });

      // When
      renderList();

      // Then
      expect(await screen.findByText("午前練習")).toBeInTheDocument();
      expect(load).toHaveBeenCalledExactlyOnceWith();
      expect(screen.getByText("2026-09-15")).toBeInTheDocument();
      expect(
        screen.getByText(roundsText("roundTotalPoints", { total: "300" })),
      ).toBeInTheDocument();
      expect(screen.getByText("午後練習")).toBeInTheDocument();
      expect(screen.getByTestId("new-round-fab")).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("ラウンドが0件の場合は空状態メッセージを表示する", async () => {
      // Given
      fetchResolves({ status: "ok", data: [] });

      // When
      renderList();

      // Then
      expect(
        await screen.findByText(roundsText("listEmpty")),
      ).toBeInTheDocument();
      expect(screen.getByTestId("new-round-fab")).toBeInTheDocument();
    });

    it("通信できない場合はネットワークに接続されていませんを表示し、空状態は表示せず、新規作成ボタンは表示する", async () => {
      // Given
      fetchResolves({ status: "offline" });

      // When
      renderList();

      // Then
      expect(
        await screen.findByText(roundsText("fetchOffline")),
      ).toBeInTheDocument();
      expect(screen.getByTestId("new-round-fab")).toBeInTheDocument();
      expect(
        screen.queryByText(roundsText("listEmpty")),
      ).not.toBeInTheDocument();
    });

    it("取得がエラーの場合はエラーメッセージを表示し、空状態は表示せず、新規作成ボタンは表示する", async () => {
      // Given
      fetchResolves({ status: "error", reason: "failed" });

      // When
      renderList();

      // Then
      expect(await screen.findByRole("alert")).toHaveTextContent(
        roundsText("fetchFailure.failed"),
      );
      expect(screen.getByTestId("new-round-fab")).toBeInTheDocument();
      expect(
        screen.queryByText(roundsText("listEmpty")),
      ).not.toBeInTheDocument();
    });

    it("新規作成ボタンは新規作成の経路へ向き、各ラウンドのカードはそのラウンドの詳細の経路へ向く", async () => {
      // Given
      fetchResolves({ status: "ok", data: rounds });

      // When
      renderList();
      await screen.findByText("午前練習");

      // Then
      expect(screen.getByTestId("new-round-fab")).toHaveAttribute(
        "href",
        NEW_ROUND_PATH,
      );
      expect(screen.getByText("午前練習").closest("a")).toHaveAttribute(
        "href",
        roundPath("round-1"),
      );
      expect(screen.getByText("午後練習").closest("a")).toHaveAttribute(
        "href",
        roundPath("round-2"),
      );
    });

    it("オフラインの結果の後に通信が戻ると、取得し直し、取得できた一覧を表示する", async () => {
      // Given
      load
        .mockResolvedValueOnce({ status: "offline" })
        .mockResolvedValueOnce({ status: "ok", data: loaded(rounds) });
      renderList();
      await screen.findByText(roundsText("fetchOffline"));

      // When
      await act(async () => procedures.returnOnline());

      // Then
      expect(await screen.findByText("午前練習")).toBeInTheDocument();
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("再試行すると取得し直し、取得できた一覧を表示する", async () => {
      // Given
      load
        .mockResolvedValueOnce({ status: "offline" })
        .mockResolvedValueOnce({ status: "ok", data: loaded(rounds) });
      const user = userEvent.setup();
      renderList();
      const retry = await screen.findByRole("button", {
        name: roundsText("fetchRetry"),
      });

      // When
      await user.click(retry);

      // Then
      expect(await screen.findByText("午前練習")).toBeInTheDocument();
      expect(load).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByText(roundsText("fetchOffline")),
      ).not.toBeInTheDocument();
    });
  });

  describe("端末の列", () => {
    it("列で削除済みのラウンドを表示しない", async () => {
      // Given
      load.mockResolvedValue({
        status: "ok",
        data: loaded(rounds, { deleted: new Set(["round-1"]) }),
      });

      // When
      renderList();

      // Then
      expect(await screen.findByText("午後練習")).toBeInTheDocument();
      expect(screen.queryByText("午前練習")).not.toBeInTheDocument();
    });
  });

  describe("ラウンドの削除", () => {
    it("確認すると、そのラウンドを削除し、ダイアログがすぐ閉じ、一覧から取り除く", async () => {
      // Given
      // 削除の保存は終わらない。
      deleteRound.mockReturnValue(new Promise(() => {}));
      const user = userEvent.setup();
      fetchResolves({ status: "ok", data: rounds });
      renderList();
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
      expect(deleteRound).toHaveBeenCalledExactlyOnceWith("round-1");
      await waitFor(() => {
        expect(screen.queryByText("午前練習")).not.toBeInTheDocument();
      });
      expect(screen.getByText("午後練習")).toBeInTheDocument();
      expect(screen.queryByTestId("confirm-dialog-confirm")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("キャンセルすると削除確認を閉じ、削除せず、一覧に残す", async () => {
      // Given
      const user = userEvent.setup();
      fetchResolves({ status: "ok", data: rounds });
      renderList();
      await screen.findByText("午前練習");
      await openDeleteDialog(user, "午前練習");

      // When
      await user.click(screen.getByTestId("confirm-dialog-cancel"));

      // Then
      await waitFor(() => {
        expect(screen.queryByTestId("confirm-dialog-cancel")).toBeNull();
      });
      expect(deleteRound).not.toHaveBeenCalled();
      expect(screen.getByText("午前練習")).toBeInTheDocument();
    });

    it("名前の有るラウンドのメニューボタンは名前を引用し、名前の無いラウンドのメニューボタンは「ラウンドのメニュー」にする", async () => {
      // Given
      fetchResolves({ status: "ok", data: roundsWithUnnamed });

      // When
      renderList();
      await screen.findByText("2026-09-17");

      // Then
      expect(
        screen.getByRole("button", {
          name: roundsText("roundMenuLabelNamed", { name: "午前練習" }),
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: roundsText("roundMenuLabel") }),
      ).toBeInTheDocument();
    });

    it("名前の無いラウンドの削除確認は、名前を引用しない", async () => {
      // Given
      const user = userEvent.setup();
      fetchResolves({ status: "ok", data: roundsWithUnnamed });
      renderList();
      await screen.findByText("2026-09-17");
      await openMenu(user, "2026-09-17");

      // When
      await user.click(await screen.findByTestId("round-delete"));

      // Then
      expect(
        screen.getByText(roundsText("roundDeleteConfirm")),
      ).toBeInTheDocument();
      expect(screen.queryByText(/「」/)).toBeNull();
    });
  });

  describe("入力中の領域", () => {
    it("取得が成功し、入力中のラウンドがあれば、見出し「入力中」の領域に表示し、その下に見出し「過去履歴」と入力中でないラウンドを表示する", async () => {
      // Given
      load.mockResolvedValue({
        status: "ok",
        data: loaded([...rounds, ...inProgressRounds]),
      });
      offlineWithLocal();

      // When
      renderList();

      // Then
      const area = await screen.findByTestId("in-progress-rounds");
      expect(
        within(area).getByRole("heading", {
          name: roundsText("listInProgress"),
        }),
      ).toBeInTheDocument();
      expect(within(area).getByText("入力中の練習")).toBeInTheDocument();
      expect(within(area).queryByText("午前練習")).not.toBeInTheDocument();
      const others = screen.getByTestId("other-rounds");
      expect(
        within(others).getByRole("heading", {
          name: roundsText("listHistory"),
        }),
      ).toBeInTheDocument();
      expect(within(others).getByText("午前練習")).toBeInTheDocument();
      expect(
        within(others).queryByText("入力中の練習"),
      ).not.toBeInTheDocument();
      expect(
        area.compareDocumentPosition(others) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);
    });

    it("オフラインでは、入力中のラウンドを表示し、「過去履歴」の下に「ネットワークに接続されていません」を表示する", async () => {
      // Given
      offlineWithLocal();
      fetchResolves({ status: "offline" });

      // When
      renderList();

      // Then
      const area = await screen.findByTestId("in-progress-rounds");
      expect(within(area).getByText("入力中の練習")).toBeInTheDocument();
      const others = screen.getByTestId("other-rounds");
      expect(
        within(others).getByRole("heading", {
          name: roundsText("listHistory"),
        }),
      ).toBeInTheDocument();
      expect(
        within(others).getByText(roundsText("fetchOffline")),
      ).toBeInTheDocument();
      expect(screen.queryByText(roundsText("listEmpty"))).toBeNull();
    });

    it("取得中は、端末の入力中の領域と「過去履歴」の下のスケルトンを、待ちなしで表示する", async () => {
      // Given
      load.mockReturnValue(new Promise(() => {}));
      offlineWithLocal();

      // When
      renderList();

      // Then
      const area = await screen.findByTestId("in-progress-rounds");
      expect(within(area).getByText("入力中の練習")).toBeInTheDocument();
      expect(
        within(screen.getByTestId("other-rounds")).getByRole("status"),
      ).toBeInTheDocument();
    });

    it("入力中のラウンドのカードも削除でき、最後の1件を消すと領域が見出しごと消える", async () => {
      // Given
      offlineWithLocal();
      fetchResolves({ status: "offline" });
      const user = userEvent.setup();
      renderList();
      await screen.findByText("入力中の練習");
      await openDeleteDialog(user, "入力中の練習");

      // When
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then
      expect(deleteRound).toHaveBeenCalledExactlyOnceWith("round-3");
      await waitFor(() => {
        expect(screen.queryByTestId("in-progress-rounds")).toBeNull();
      });
      expect(
        screen.queryByRole("heading", { name: roundsText("listInProgress") }),
      ).toBeNull();
      expect(
        screen.queryByRole("heading", { name: roundsText("listHistory") }),
      ).toBeNull();
    });

    it("削除したラウンドは、再試行で取得が変わっても表示しない", async () => {
      // Given
      offlineWithLocal();
      load.mockResolvedValueOnce({ status: "offline" }).mockResolvedValueOnce({
        status: "ok",
        data: loaded([...rounds, ...inProgressRounds]),
      });
      const user = userEvent.setup();
      renderList();
      await screen.findByText("入力中の練習");
      await openDeleteDialog(user, "入力中の練習");
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // When
      await user.click(
        await screen.findByRole("button", { name: roundsText("fetchRetry") }),
      );

      // Then
      expect(await screen.findByText("午前練習")).toBeInTheDocument();
      expect(screen.queryByText("入力中の練習")).toBeNull();
    });
  });
});
