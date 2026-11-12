import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { createFakeHistoryViewMemory } from "../application/fake-history-view-memory-test-helpers";
import {
  DEFAULT_HISTORY_CONDITION,
  DEFAULT_HISTORY_VIEW_STATE,
  type HistoryViewState,
} from "../domain/history-view-state";
import { BOW_TYPE_OPTIONS, FORMAT_OPTIONS } from "../domain/round-constants";
import type { LoadedRoundsList, RoundListItem } from "../domain/round-list";
import { installFakeIntersectionObserver } from "./intersection-observer-test-helpers";
import {
  fakeSearchParams,
  followReplaceState,
} from "./navigation-test-helpers";
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

vi.mock("next/navigation", async () => {
  const { fakeSearchParams: fake } = await import("./navigation-test-helpers");
  return { useSearchParams: fake.useSearchParams };
});

const roundsText = translatorFor("rounds");

// 取得、端末の列、削除の実物はそれぞれのテストで確かめる。ここでは偽の約束で渡す。
let fake: ReturnType<typeof createFakeRoundsListStore>;
let fakeWindow: ReturnType<typeof createFakeRoundWindow>;
let procedures: ReturnType<typeof createFakeRoundProcedures>;
let memory: ReturnType<typeof createFakeHistoryViewMemory>;
let intersection: ReturnType<typeof installFakeIntersectionObserver>;

// 続きの有無と起点は、既定では続きなし・最後の項目。
function loaded(
  items: RoundListItem[],
  overrides: Partial<LoadedRoundsList> = {},
): LoadedRoundsList {
  return {
    items,
    hasMore: false,
    after: items.at(-1)?.id ?? null,
    deleted: new Set(),
    ...overrides,
  };
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

function roundItem(
  id: string,
  name: string,
  overrides: Partial<RoundListItem> = {},
): RoundListItem {
  return { id, name, roundDate: "2026-09-15", total: 0, ...overrides };
}

const completed: RoundListItem[] = [
  roundItem("round-1", "午前練習", { roundDate: "2026-09-15", total: 300 }),
  roundItem("round-2", "午後練習", { roundDate: "2026-09-16", total: 280 }),
];

// サーバーが返す並び。実施日の順でも得点の順でもなく、端末が並べ直さないことを見分けられる。
const varied: RoundListItem[] = [
  roundItem("round-3", "夜練習", { roundDate: "2026-09-17", total: 340 }),
  roundItem("round-1", "午前練習", { roundDate: "2026-09-15", total: 300 }),
  roundItem("round-4", "朝練習", { roundDate: "2026-09-10", total: 200 }),
  roundItem("round-2", "午後練習", { roundDate: "2026-09-16", total: 280 }),
];

function shownNames(): (string | undefined)[] {
  return screen
    .queryAllByRole("listitem")
    .map(
      (listItem) =>
        varied.find((round) => listItem.textContent?.includes(round.name))
          ?.name,
    );
}

function remember(state: HistoryViewState) {
  memory = createFakeHistoryViewMemory(state);
  procedures.historyViewMemory = memory.memory;
}

function fetchResolves(
  items: RoundListItem[],
  overrides: Partial<LoadedRoundsList> = {},
) {
  fake.store.loadList.mockResolvedValue({
    status: "ok",
    data: loaded(items, overrides),
  });
}

// 先頭のページの次の取得として、結果を返す前の取得を差し込む。
function nextFetchPends() {
  const next = Promise.withResolvers<unknown>();
  fake.store.loadList.mockReturnValueOnce(next.promise);
  return next;
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
  fake.store.loadList.mockReturnValue(new Promise(() => {}));
  procedures = createFakeRoundProcedures();
  remember(DEFAULT_HISTORY_VIEW_STATE);
  // offlineの結果が返る状況は通信が切れている(切れていないと、すぐ再取得する)。
  procedures.goOffline();
  fakeWindow = createFakeRoundWindow();
  fakeWindow.setLocal({ inProgress: [] });
  followReplaceState();
  // jsdomには交差の判定が無いため、偽物で末尾が近づいたことを起こす。
  intersection = installFakeIntersectionObserver();
});

afterEach(() => {
  fakeSearchParams.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
      expect(fake.store.loadList).toHaveBeenCalledExactlyOnceWith(
        DEFAULT_HISTORY_CONDITION,
        null,
        expect.any(Number),
      );
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

    it("サーバーが返した並びのまま表示し、端末で並べ直さない", async () => {
      // Given
      fetchResolves(varied);

      // When
      renderHistory();
      await screen.findByText("夜練習");

      // Then
      expect(shownNames()).toEqual([
        "夜練習",
        "午前練習",
        "朝練習",
        "午後練習",
      ]);
    });

    it("取得結果が0件なら、該当するラウンドがないことだけを表示する", async () => {
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

  describe("並べ替えと絞り込み", () => {
    const click = (testId: string, user: ReturnType<typeof userEvent.setup>) =>
      user.click(screen.getByTestId(testId));

    it("種別と弓種の選択肢を、ラウンドの設定画面と同じ表示名で出す", async () => {
      // Given
      fetchResolves(varied);

      // When
      renderHistory();
      await screen.findByText("夜練習");

      // Then
      for (const format of FORMAT_OPTIONS) {
        expect(
          screen.getByTestId(`history-filter-format-${format}`),
        ).toHaveTextContent(roundsText(`formatOption.${format}`));
      }
      for (const bowType of BOW_TYPE_OPTIONS) {
        expect(
          screen.getByTestId(`history-filter-bow-type-${bowType}`),
        ).toHaveTextContent(roundsText(`bowTypeOption.${bowType}`));
      }
    });

    it("選んだ並べ替えと絞り込みの条件を、先頭から取得し直す取得に渡す", async () => {
      // Given
      fetchResolves(varied);
      const user = userEvent.setup();
      renderHistory();
      await screen.findByText("夜練習");

      // When
      await click("history-filter-format-indoor", user);
      await click("history-filter-bow-type-compound", user);
      await click("history-sort-key-score", user);
      await click("history-sort-direction-asc", user);

      // Then
      expect(fake.store.loadList).toHaveBeenLastCalledWith(
        {
          sortKey: "score",
          sortDirection: "asc",
          format: "indoor",
          bowType: "compound",
        },
        null,
        expect.any(Number),
      );
    });

    it("絞り込みで「すべて」を選ぶと、指定なしの条件で取得し直す", async () => {
      // Given
      fetchResolves(varied);
      const user = userEvent.setup();
      renderHistory();
      await screen.findByText("夜練習");
      await click("history-filter-format-indoor", user);
      await click("history-filter-bow-type-compound", user);

      // When
      await click("history-filter-format-all", user);
      await click("history-filter-bow-type-all", user);

      // Then
      expect(fake.store.loadList).toHaveBeenLastCalledWith(
        DEFAULT_HISTORY_CONDITION,
        null,
        expect.any(Number),
      );
    });

    it("条件を変えると、表示済みを捨ててスケルトンになり、条件の欄は取得中も表示される", async () => {
      // Given
      fetchResolves(varied);
      const user = userEvent.setup();
      renderHistory();
      await screen.findByText("夜練習");
      nextFetchPends();

      // When
      await click("history-filter-format-outdoor", user);

      // Then
      expect(screen.getByRole("status")).toHaveTextContent(
        roundsText("fetchLoading"),
      );
      expect(screen.queryByRole("listitem")).toBeNull();
      expect(screen.getByTestId("history-controls")).toBeInTheDocument();
    });

    it("条件を変えて取得し直した結果を、サーバーが返した並びのまま表示する", async () => {
      // Given
      fetchResolves(varied);
      const user = userEvent.setup();
      renderHistory();
      await screen.findByText("夜練習");
      fetchResolves([varied[2], varied[1]]);

      // When
      await click("history-filter-format-outdoor", user);

      // Then
      await waitFor(() => {
        expect(shownNames()).toEqual(["朝練習", "午前練習"]);
      });
    });

    it("条件に一致するラウンドがなければ、該当するラウンドがないことだけを表示する", async () => {
      // Given
      fetchResolves(varied);
      const user = userEvent.setup();
      renderHistory();
      await screen.findByText("夜練習");
      fetchResolves([]);

      // When
      await click("history-filter-format-field", user);

      // Then
      expect(
        await screen.findByText(roundsText("historyEmpty")),
      ).toBeInTheDocument();
      expect(screen.queryByText(roundsText("historyEnd"))).toBeNull();
      expect(screen.queryByRole("listitem")).toBeNull();
    });

    it("条件を選んだ状態で削除すると、そのラウンドが表示から消える", async () => {
      // Given
      fetchResolves(varied);
      const user = userEvent.setup();
      renderHistory();
      await screen.findByText("夜練習");
      fetchResolves([varied[0], varied[3]]);
      await click("history-filter-format-indoor", user);
      await screen.findByText("午後練習");
      await openDeleteDialog(user, "夜練習");

      // When
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then
      await waitFor(() => {
        expect(shownNames()).toEqual(["午後練習"]);
      });
    });
  });

  describe("並べ替えと絞り込みの欄の開閉", () => {
    it("取っ手を押すと欄が隠れ、もう一度押すと現れる", async () => {
      // Given
      fetchResolves(varied);
      const user = userEvent.setup();
      renderHistory();
      await screen.findByText("夜練習");
      const toggle = screen.getByTestId("history-controls-toggle");

      // When
      await user.click(toggle);
      const hidden = screen.queryByTestId("history-controls");
      await user.click(toggle);

      // Then
      expect(hidden).toBeNull();
      expect(screen.getByTestId("history-controls")).toBeInTheDocument();
    });

    it("閉じている間は、選んだ条件もリセットも示さない", async () => {
      // Given
      fetchResolves(varied);
      const user = userEvent.setup();
      renderHistory();
      await screen.findByText("夜練習");
      await user.click(screen.getByTestId("history-filter-format-indoor"));

      // When
      await user.click(screen.getByTestId("history-controls-toggle"));

      // Then
      expect(screen.queryByTestId("history-filter-format-indoor")).toBeNull();
      expect(screen.queryByTestId("history-sort-key-score")).toBeNull();
      expect(screen.queryByTestId("history-controls-reset")).toBeNull();
      expect(screen.getByTestId("history-controls-toggle")).toBeInTheDocument();
    });

    it("閉じても条件は適用され続け、取得し直さず、ラウンドの表示は変わらない", async () => {
      // Given
      fetchResolves(varied);
      const user = userEvent.setup();
      renderHistory();
      await screen.findByText("夜練習");
      await user.click(screen.getByTestId("history-filter-format-indoor"));
      await user.click(screen.getByTestId("history-sort-key-score"));
      await screen.findByText("夜練習");
      const fetches = fake.store.loadList.mock.calls.length;
      const before = shownNames();

      // When
      await user.click(screen.getByTestId("history-controls-toggle"));

      // Then
      expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
      expect(shownNames()).toEqual(before);
    });
  });

  describe("条件のリセット", () => {
    it("リセットすると、並べ替えと絞り込みが既定に戻って既定の条件で取得し直し、欄は開いたまま、記憶も既定になる", async () => {
      // Given
      fetchResolves(varied);
      const user = userEvent.setup();
      renderHistory();
      await screen.findByText("夜練習");
      await user.click(screen.getByTestId("history-sort-key-score"));
      await user.click(screen.getByTestId("history-sort-direction-asc"));
      await user.click(screen.getByTestId("history-filter-format-indoor"));
      await user.click(screen.getByTestId("history-filter-bow-type-recurve"));

      // When
      await user.click(screen.getByTestId("history-controls-reset"));

      // Then
      expect(fake.store.loadList).toHaveBeenLastCalledWith(
        DEFAULT_HISTORY_CONDITION,
        null,
        expect.any(Number),
      );
      expect(screen.getByTestId("history-controls")).toBeInTheDocument();
      expect(memory.stored()).toEqual({
        condition: DEFAULT_HISTORY_CONDITION,
        filterOpen: true,
      });
    });
  });

  describe("条件の保持", () => {
    it("記憶された条件で取得し、閉じた状態で表示を始める", async () => {
      // Given
      remember({
        condition: {
          sortKey: "score",
          sortDirection: "asc",
          format: "indoor",
          bowType: null,
        },
        filterOpen: false,
      });
      fetchResolves(varied);

      // When
      renderHistory();

      // Then
      await screen.findByText("夜練習");
      expect(fake.store.loadList).toHaveBeenCalledExactlyOnceWith(
        {
          sortKey: "score",
          sortDirection: "asc",
          format: "indoor",
          bowType: null,
        },
        null,
        expect.any(Number),
      );
      expect(screen.queryByTestId("history-controls")).toBeNull();
    });

    it("記憶された条件で開いた状態で表示を始めると、その条件が選ばれた状態で欄が表示される", async () => {
      // Given
      remember({
        condition: {
          sortKey: "score",
          sortDirection: "asc",
          format: "outdoor",
          bowType: "barebow",
        },
        filterOpen: true,
      });
      fetchResolves(varied);

      // When
      renderHistory();

      // Then
      expect(await screen.findByText("朝練習")).toBeInTheDocument();
      expect(screen.getByTestId("history-sort-key-score")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByTestId("history-sort-direction-asc")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(
        screen.getByTestId("history-filter-format-outdoor"),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        screen.getByTestId("history-filter-bow-type-barebow"),
      ).toHaveAttribute("aria-pressed", "true");
    });

    it("並べ替えと絞り込みを変えると、その条件が記憶に書かれる", async () => {
      // Given
      fetchResolves(varied);
      const user = userEvent.setup();
      renderHistory();
      await screen.findByText("夜練習");

      // When
      await user.click(screen.getByTestId("history-sort-key-score"));
      await user.click(screen.getByTestId("history-sort-direction-asc"));
      await user.click(screen.getByTestId("history-filter-format-indoor"));
      await user.click(screen.getByTestId("history-filter-bow-type-compound"));

      // Then
      expect(memory.stored()).toEqual({
        condition: {
          sortKey: "score",
          sortDirection: "asc",
          format: "indoor",
          bowType: "compound",
        },
        filterOpen: true,
      });
    });

    it("欄を閉じると、閉じたことが条件を保ったまま記憶に書かれる", async () => {
      // Given
      fetchResolves(varied);
      const user = userEvent.setup();
      renderHistory();
      await screen.findByText("夜練習");
      await user.click(screen.getByTestId("history-filter-format-field"));

      // When
      await user.click(screen.getByTestId("history-controls-toggle"));

      // Then
      expect(memory.stored()).toEqual({
        condition: { ...DEFAULT_HISTORY_CONDITION, format: "field" },
        filterOpen: false,
      });
    });
  });

  describe("一覧の末尾", () => {
    it("続きがなく1件以上あるときは、該当するラウンドは以上であることを表示する", async () => {
      // Given
      fetchResolves(completed);

      // When
      renderHistory();
      await screen.findByText("午前練習");

      // Then
      expect(screen.getByText(roundsText("historyEnd"))).toBeInTheDocument();
    });

    it("続きがあるときは、以上の文言も空の文言も出さない", async () => {
      // Given
      fetchResolves(completed, { hasMore: true });

      // When
      renderHistory();
      await screen.findByText("午前練習");

      // Then
      expect(screen.queryByText(roundsText("historyEnd"))).toBeNull();
      expect(screen.queryByText(roundsText("historyEmpty"))).toBeNull();
    });

    it("端末で除いて表示が0件になっても、続きがあれば空の文言を出さない", async () => {
      // Given
      fakeWindow.setLocal({ inProgress: [completed[0]] });
      fetchResolves([completed[0]], { hasMore: true });

      // When
      renderHistory();
      await waitFor(() => {
        expect(screen.queryByRole("status")).toBeNull();
      });

      // Then
      expect(screen.queryByRole("listitem")).toBeNull();
      expect(screen.queryByText(roundsText("historyEmpty"))).toBeNull();
    });

    it("末尾が近づくと続きを取得して、取得済みの下に続けて表示する", async () => {
      // Given
      fake.store.loadList
        .mockResolvedValueOnce({
          status: "ok",
          data: loaded([completed[0]], { hasMore: true }),
        })
        .mockResolvedValueOnce({
          status: "ok",
          data: loaded([completed[1]]),
        });
      renderHistory();
      await screen.findByText("午前練習");

      // When
      await act(async () => intersection.intersect());

      // Then
      expect(await screen.findByText("午後練習")).toBeInTheDocument();
      expect(screen.getByText("午前練習")).toBeInTheDocument();
      expect(fake.store.loadList).toHaveBeenLastCalledWith(
        DEFAULT_HISTORY_CONDITION,
        "round-1",
        expect.any(Number),
      );
      expect(screen.getByText(roundsText("historyEnd"))).toBeInTheDocument();
    });

    it("続きの取得中は、取得済みを残して読み込み中の表示を出す", async () => {
      // Given
      fetchResolves([completed[0]], { hasMore: true });
      renderHistory();
      await screen.findByText("午前練習");
      nextFetchPends();

      // When
      await act(async () => intersection.intersect());

      // Then
      expect(screen.getByRole("status")).toHaveTextContent(
        roundsText("fetchLoading"),
      );
      expect(screen.getByText("午前練習")).toBeInTheDocument();
    });

    it("続きの取得が失敗すると、取得済みを残して失敗の文言と再試行ボタンを出し、再試行すると続きを表示する", async () => {
      // Given
      fake.store.loadList
        .mockResolvedValueOnce({
          status: "ok",
          data: loaded([completed[0]], { hasMore: true }),
        })
        .mockResolvedValueOnce({ status: "offline" })
        .mockResolvedValueOnce({
          status: "ok",
          data: loaded([completed[1]]),
        });
      const user = userEvent.setup();
      renderHistory();
      await screen.findByText("午前練習");
      await act(async () => intersection.intersect());
      const retry = await screen.findByRole("button", {
        name: roundsText("fetchRetry"),
      });
      expect(screen.getByText("午前練習")).toBeInTheDocument();
      expect(screen.getByText(roundsText("fetchOffline"))).toBeInTheDocument();

      // When
      await user.click(retry);

      // Then
      expect(await screen.findByText("午後練習")).toBeInTheDocument();
      expect(fake.store.loadList).toHaveBeenLastCalledWith(
        DEFAULT_HISTORY_CONDITION,
        "round-1",
        expect.any(Number),
      );
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
