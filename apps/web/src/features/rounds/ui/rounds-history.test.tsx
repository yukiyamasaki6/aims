import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { createFakeHistoryViewMemory } from "../application/fake-history-view-memory-test-helpers";
import {
  DEFAULT_HISTORY_CONDITION,
  DEFAULT_HISTORY_VIEW_STATE,
  type HistoryDistanceError,
  type HistoryDistanceRow,
  type HistoryRangeError,
  type HistoryViewState,
} from "../domain/history-view-state";
import { BOW_TYPE_OPTIONS, FORMAT_OPTIONS } from "../domain/round-constants";
import type { LoadedRoundsList, RoundListItem } from "../domain/round-list";
import type { TargetFaceOption } from "../domain/target-face";
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

function rangeInput(name: string) {
  return screen.getByTestId(`history-filter-${name}`);
}

// 下書きを入れるだけで、欄は離れない。
function draftRange(name: string, value: string) {
  fireEvent.change(rangeInput(name), { target: { value } });
}

// 入力欄を離れて、下書きの検証と反映を起こす。
function leaveRange(name: string) {
  fireEvent.blur(rangeInput(name));
}

// 輪を1つだけ持つ的。的の表示は輪を持つ的を前提にする。
const SINGLE_RING_SPOTS = [
  {
    center_x: 0,
    center_y: 0,
    target_face_rings: [
      {
        radius: 1,
        color: "#FFFFFF",
        line_color: null,
        z_index: 1,
        score_str: "M",
        score_int: 0,
      },
    ],
  },
];

// 保存した的の一覧。UUIDの形のIDで、屋外・インドアが混ざる。
const OUTDOOR_FACE: TargetFaceOption = {
  id: "a1000000-0000-0000-0000-000000000001",
  name: "122cmアウトドア",
  size: 122,
  format: "outdoor",
  bow_type: ["recurve", "compound"],
  target_face_spots: SINGLE_RING_SPOTS,
};
const INDOOR_FACE: TargetFaceOption = {
  id: "a1000000-0000-0000-0000-000000000004",
  name: "60cmインドア",
  size: 60,
  format: "indoor",
  bow_type: ["recurve", "compound"],
  target_face_spots: SINGLE_RING_SPOTS,
};
const FACES = [OUTDOOR_FACE, INDOOR_FACE];

const VARIED_NAMES = ["夜練習", "午前練習", "朝練習", "午後練習"];

function distanceRow(
  distance: number,
  overrides: Partial<HistoryDistanceRow> = {},
): HistoryDistanceRow {
  return {
    distance,
    arrowsPerEnd: null,
    totalArrows: null,
    targetFaceId: null,
    ...overrides,
  };
}

function distanceInput(index: number, field: string) {
  return screen.getByTestId(`history-filter-distance-${index}-${field}`);
}

// 下書きを入れるだけで、欄は離れない。
function draftDistance(index: number, field: string, value: string) {
  fireEvent.change(distanceInput(index, field), { target: { value } });
}

// 入力欄を離れて、下書きの検証と反映を起こす。
function leaveDistance(index: number, field: string) {
  fireEvent.blur(distanceInput(index, field));
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
          ...DEFAULT_HISTORY_CONDITION,

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

  describe("期間と得点の範囲", () => {
    async function renderOpened() {
      fetchResolves(varied);
      renderHistory();
      await screen.findByText("夜練習");
      return userEvent.setup();
    }

    it.each([
      ["開始日", "dateFrom", "2026-05-01", { dateFrom: "2026-05-01" }],
      ["終了日", "dateTo", "2026-05-31", { dateTo: "2026-05-31" }],
      ["下限", "scoreMin", "300", { scoreMin: 300 }],
      ["上限", "scoreMax", "600", { scoreMax: 600 }],
    ])(
      "%sを入力して欄を離れると、その指定だけを渡して先頭から取得し直し、表示中のラウンドはスケルトンに置き換わる",
      async (_name, field, text, expected) => {
        // Given
        const user = await renderOpened();
        nextFetchPends();

        // When
        await user.type(rangeInput(field), text);
        await user.tab();

        // Then
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          { ...DEFAULT_HISTORY_CONDITION, ...expected },
          null,
          expect.any(Number),
        );
        expect(screen.getByRole("status")).toHaveTextContent(
          roundsText("fetchLoading"),
        );
        expect(screen.queryByRole("listitem")).toBeNull();
      },
    );

    it("Enterを押すと、欄を離れたときと同じく反映して取得し直す", async () => {
      // Given
      const user = await renderOpened();

      // When
      await user.type(rangeInput("scoreMin"), "300{Enter}");

      // Then
      expect(fake.store.loadList).toHaveBeenLastCalledWith(
        { ...DEFAULT_HISTORY_CONDITION, scoreMin: 300 },
        null,
        expect.any(Number),
      );
    });

    it("入力の途中は検証も取得もせず、欄を離れたときに最後の値で1回だけ取得する", async () => {
      // Given
      const user = await renderOpened();
      const fetches = fake.store.loadList.mock.calls.length;

      // When
      await user.type(rangeInput("scoreMin"), "500");
      const duringTyping = fake.store.loadList.mock.calls.length;
      await user.tab();

      // Then
      expect(duringTyping).toBe(fetches);
      expect(fake.store.loadList).toHaveBeenCalledTimes(fetches + 1);
      expect(fake.store.loadList).toHaveBeenLastCalledWith(
        { ...DEFAULT_HISTORY_CONDITION, scoreMin: 500 },
        null,
        expect.any(Number),
      );
    });

    it("空にして欄を離れると、その指定だけを解除した条件で取得し直す", async () => {
      // Given
      remember({
        condition: {
          ...DEFAULT_HISTORY_CONDITION,
          dateFrom: "2026-05-01",
          scoreMin: 300,
        },
        filterOpen: true,
      });
      fetchResolves(varied);
      renderHistory();
      await screen.findByText("夜練習");
      const user = userEvent.setup();

      // When
      await user.clear(rangeInput("scoreMin"));
      await user.tab();

      // Then
      expect(fake.store.loadList).toHaveBeenLastCalledWith(
        { ...DEFAULT_HISTORY_CONDITION, dateFrom: "2026-05-01" },
        null,
        expect.any(Number),
      );
    });

    it("反映済みと同じ値を入れ直して欄を離れても、取得し直さず、スケルトンにならない", async () => {
      // Given
      remember({
        condition: { ...DEFAULT_HISTORY_CONDITION, scoreMin: 300 },
        filterOpen: true,
      });
      fetchResolves(varied);
      renderHistory();
      await screen.findByText("夜練習");
      const user = userEvent.setup();
      const fetches = fake.store.loadList.mock.calls.length;

      // When
      await user.clear(rangeInput("scoreMin"));
      await user.type(rangeInput("scoreMin"), "300");
      await user.tab();

      // Then
      expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
      expect(screen.queryByRole("status")).toBeNull();
      expect(shownNames()).toEqual([
        "夜練習",
        "午前練習",
        "朝練習",
        "午後練習",
      ]);
    });

    it("4つの下書きをまとめて検証し、組が正しくなった時点で、両方を反映して1回取得する", async () => {
      // Given
      const user = await renderOpened();
      await user.type(rangeInput("dateTo"), "2026-05-01");
      await user.tab();
      await screen.findByText("夜練習");
      await user.type(rangeInput("dateFrom"), "2026-05-02");
      await user.tab();
      const fetches = fake.store.loadList.mock.calls.length;

      // When
      await user.clear(rangeInput("dateTo"));
      await user.type(rangeInput("dateTo"), "2026-05-31");
      await user.tab();

      // Then
      expect(fake.store.loadList).toHaveBeenCalledTimes(fetches + 1);
      expect(fake.store.loadList).toHaveBeenLastCalledWith(
        {
          ...DEFAULT_HISTORY_CONDITION,
          dateFrom: "2026-05-02",
          dateTo: "2026-05-31",
        },
        null,
        expect.any(Number),
      );
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("得点の入力は、数字でない文字を打っても入力した文字がそのまま残る", async () => {
      // Given
      // jsdomのtype="number"は途中の文字を空として返すため、type="number"でないことをこの結果で確かめる。
      const user = await renderOpened();

      // When
      await user.type(rangeInput("scoreMin"), "-1e");

      // Then
      expect(rangeInput("scoreMin")).toHaveValue("-1e");
    });

    it("取得中も、入力欄は同じ要素のまま入力途中の文字とフォーカスを保つ", async () => {
      // Given
      const user = await renderOpened();
      const scoreMax = rangeInput("scoreMax");
      await user.type(rangeInput("scoreMin"), "300");
      nextFetchPends();
      await user.click(scoreMax);

      // When
      await user.type(scoreMax, "6");

      // Then
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(rangeInput("scoreMax")).toBe(scoreMax);
      expect(scoreMax).toHaveValue("6");
      expect(scoreMax).toHaveFocus();
      expect(rangeInput("scoreMin")).toHaveValue("300");
    });

    it.each([
      [
        "開始日が終了日より後",
        { dateFrom: "2026-05-02", dateTo: "2026-05-01" },
        "dateFrom",
        "dateOrder",
      ],
      ["点数が不正", { scoreMin: "12a" }, "scoreMin", "scoreInvalid"],
      [
        "下限が上限より大きい",
        { scoreMin: "10", scoreMax: "9" },
        "scoreMin",
        "scoreOrder",
      ],
    ])(
      "%sなら、入力の近くにその原因の文言を出し、取得せず、直前の結果のカードと入力した文字を残す",
      async (_name, drafts, leaving, error) => {
        // Given
        await renderOpened();
        const fetches = fake.store.loadList.mock.calls.length;

        // When
        for (const [field, value] of Object.entries(drafts)) {
          draftRange(field, value);
        }
        leaveRange(leaving);

        // Then
        expect(
          screen.getByTestId(`history-filter-error-${error}`),
        ).toHaveTextContent(
          roundsText(`historyRangeError.${error as HistoryRangeError}`),
        );
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
        expect(screen.queryByRole("status")).toBeNull();
        expect(shownNames()).toEqual([
          "夜練習",
          "午前練習",
          "朝練習",
          "午後練習",
        ]);
        for (const [field, value] of Object.entries(drafts)) {
          expect(rangeInput(field)).toHaveValue(value);
        }
      },
    );

    it("不正を直して欄を離れると、エラーが消え、反映して取得し直す", async () => {
      // Given
      await renderOpened();
      draftRange("scoreMin", "12a");
      leaveRange("scoreMin");
      const fetches = fake.store.loadList.mock.calls.length;

      // When
      draftRange("scoreMin", "12");
      leaveRange("scoreMin");

      // Then
      expect(screen.queryByRole("alert")).toBeNull();
      expect(fake.store.loadList).toHaveBeenCalledTimes(fetches + 1);
      expect(fake.store.loadList).toHaveBeenLastCalledWith(
        { ...DEFAULT_HISTORY_CONDITION, scoreMin: 12 },
        null,
        expect.any(Number),
      );
    });

    it("複数の原因が同時にあれば、それぞれの文言を出す", async () => {
      // Given
      await renderOpened();

      // When
      draftRange("dateFrom", "2026-05-02");
      draftRange("dateTo", "2026-05-01");
      draftRange("scoreMin", "10");
      draftRange("scoreMax", "9");
      leaveRange("scoreMax");

      // Then
      expect(
        screen.getByTestId("history-filter-error-dateOrder"),
      ).toBeVisible();
      expect(
        screen.getByTestId("history-filter-error-scoreOrder"),
      ).toBeVisible();
    });

    it("不正な入力は、記憶に書かない", async () => {
      // Given
      await renderOpened();

      // When
      draftRange("scoreMin", "12a");
      leaveRange("scoreMin");

      // Then
      expect(memory.stored()).toEqual(DEFAULT_HISTORY_VIEW_STATE);
    });

    it("正しい下書きを入れたまま欄を閉じると、反映して取得し、閉じたことと範囲を記憶に書く", async () => {
      // Given
      const user = await renderOpened();
      await user.type(rangeInput("scoreMin"), "300");

      // When
      await user.click(screen.getByTestId("history-controls-toggle"));

      // Then
      expect(fake.store.loadList).toHaveBeenLastCalledWith(
        { ...DEFAULT_HISTORY_CONDITION, scoreMin: 300 },
        null,
        expect.any(Number),
      );
      expect(screen.queryByTestId("history-controls")).toBeNull();
      expect(memory.stored()).toEqual({
        condition: { ...DEFAULT_HISTORY_CONDITION, scoreMin: 300 },
        filterOpen: false,
      });
    });

    it("不正な下書きを入れたまま欄を閉じると、取得せず表示も変えず、開き直すと反映済みの値が出てエラーは消えている", async () => {
      // Given
      remember({
        condition: { ...DEFAULT_HISTORY_CONDITION, scoreMin: 300 },
        filterOpen: true,
      });
      fetchResolves(varied);
      renderHistory();
      await screen.findByText("夜練習");
      const user = userEvent.setup();
      await user.type(rangeInput("scoreMin"), "x");
      const fetches = fake.store.loadList.mock.calls.length;

      // When
      await user.click(screen.getByTestId("history-controls-toggle"));
      await user.click(screen.getByTestId("history-controls-toggle"));

      // Then
      expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
      expect(shownNames()).toEqual([
        "夜練習",
        "午前練習",
        "朝練習",
        "午後練習",
      ]);
      expect(rangeInput("scoreMin")).toHaveValue("300");
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("閉じている間は、選んだ範囲もエラーも示さず、範囲の条件は適用され続ける", async () => {
      // Given
      remember({
        condition: { ...DEFAULT_HISTORY_CONDITION, scoreMin: 300 },
        filterOpen: false,
      });
      fetchResolves(varied);

      // When
      renderHistory();
      await screen.findByText("夜練習");

      // Then
      expect(screen.queryByTestId("history-filter-scoreMin")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(fake.store.loadList).toHaveBeenCalledExactlyOnceWith(
        { ...DEFAULT_HISTORY_CONDITION, scoreMin: 300 },
        null,
        expect.any(Number),
      );
    });

    it("記憶された範囲で取得し、欄を開いた状態でその値が入力に出る", async () => {
      // Given
      remember({
        condition: {
          ...DEFAULT_HISTORY_CONDITION,
          dateFrom: "2026-05-01",
          dateTo: "2026-05-31",
          scoreMin: 0,
          scoreMax: 600,
        },
        filterOpen: true,
      });
      fetchResolves(varied);

      // When
      renderHistory();

      // Then
      await screen.findByText("夜練習");
      expect(fake.store.loadList).toHaveBeenCalledExactlyOnceWith(
        {
          ...DEFAULT_HISTORY_CONDITION,
          dateFrom: "2026-05-01",
          dateTo: "2026-05-31",
          scoreMin: 0,
          scoreMax: 600,
        },
        null,
        expect.any(Number),
      );
      expect(rangeInput("dateFrom")).toHaveValue("2026-05-01");
      expect(rangeInput("dateTo")).toHaveValue("2026-05-31");
      expect(rangeInput("scoreMin")).toHaveValue("0");
      expect(rangeInput("scoreMax")).toHaveValue("600");
    });

    it("範囲を変えると、その条件が記憶に書かれる", async () => {
      // Given
      const user = await renderOpened();

      // When
      await user.type(rangeInput("dateFrom"), "2026-05-01");
      await user.type(rangeInput("scoreMax"), "600");
      await user.tab();

      // Then
      expect(memory.stored()).toEqual({
        condition: {
          ...DEFAULT_HISTORY_CONDITION,
          dateFrom: "2026-05-01",
          scoreMax: 600,
        },
        filterOpen: true,
      });
    });

    it("範囲に一致するラウンドがなければ、該当するラウンドがないことだけを表示する", async () => {
      // Given
      const user = await renderOpened();
      fetchResolves([]);

      // When
      await user.type(rangeInput("scoreMin"), "9999{Enter}");

      // Then
      expect(
        await screen.findByText(roundsText("historyEmpty")),
      ).toBeInTheDocument();
      expect(screen.queryByText(roundsText("historyEnd"))).toBeNull();
      expect(screen.queryByRole("listitem")).toBeNull();
    });
  });

  describe("距離の構成", () => {
    async function renderWithDistances(
      distances: HistoryDistanceRow[] = [],
      overrides: Partial<HistoryViewState["condition"]> = {},
    ) {
      remember({
        condition: { ...DEFAULT_HISTORY_CONDITION, ...overrides, distances },
        filterOpen: true,
      });
      fetchResolves(varied);
      renderHistory();
      await screen.findByText("夜練習");
      return userEvent.setup();
    }

    // 空の行を足し、距離を入れて離れる。
    async function addDistanceRow(
      user: ReturnType<typeof userEvent.setup>,
      index: number,
      distance: string,
    ) {
      await user.click(screen.getByTestId("history-filter-distance-add"));
      await user.type(distanceInput(index, "distance"), distance);
      await user.tab();
    }

    function conditionWith(distances: HistoryDistanceRow[]) {
      return { ...DEFAULT_HISTORY_CONDITION, distances };
    }

    describe("行の追加と反映", () => {
      it("欄を開くと、行は0件で「距離を追加」だけがあり、何も取得し直さない", async () => {
        // Given
        fetchResolves(varied);

        // When
        renderHistory();
        await screen.findByText("夜練習");

        // Then
        expect(
          screen.getByTestId("history-filter-distance-add"),
        ).toBeInTheDocument();
        expect(screen.queryByTestId("history-filter-distance-0")).toBeNull();
        expect(fake.store.loadList).toHaveBeenCalledTimes(1);
      });

      it("「距離を追加」を押すたびに末尾へ空の行が増え、取得も条件の変更も起こさない", async () => {
        // Given
        const user = await renderWithDistances();
        const fetches = fake.store.loadList.mock.calls.length;

        // When
        await user.click(screen.getByTestId("history-filter-distance-add"));
        await user.click(screen.getByTestId("history-filter-distance-add"));

        // Then
        const row = screen.getByTestId("history-filter-distance-0");
        expect(
          within(row).getByTestId("history-filter-distance-0-distance"),
        ).toHaveValue("");
        expect(
          within(row).getByTestId("history-filter-distance-0-arrowsPerEnd"),
        ).toHaveValue("");
        expect(
          within(row).getByTestId("history-filter-distance-0-totalArrows"),
        ).toHaveValue("");
        expect(
          within(row).getByTestId("history-filter-distance-0-target-add"),
        ).toBeInTheDocument();
        expect(
          within(row).getByTestId("history-filter-distance-0-remove"),
        ).toBeInTheDocument();
        expect(screen.getByTestId("history-filter-distance-1")).toBeVisible();
        expect(screen.queryByTestId("history-filter-distance-2")).toBeNull();
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
        expect(memory.stored()).toEqual(DEFAULT_HISTORY_VIEW_STATE);
      });

      it.each([
        ["欄を離れる", "{Tab}"],
        ["Enterを押す", "{Enter}"],
      ])(
        "距離を入力して%sと、その行だけの距離の構成で先頭から取得し直し、表示中のラウンドはスケルトンに置き換わる",
        async (_name, key) => {
          // Given
          const user = await renderWithDistances();
          await user.click(screen.getByTestId("history-filter-distance-add"));
          nextFetchPends();

          // When
          await user.type(distanceInput(0, "distance"), `50${key}`);

          // Then
          expect(fake.store.loadList).toHaveBeenLastCalledWith(
            conditionWith([distanceRow(50)]),
            null,
            expect.any(Number),
          );
          expect(screen.getByRole("status")).toHaveTextContent(
            roundsText("fetchLoading"),
          );
          expect(screen.queryByRole("listitem")).toBeNull();
        },
      );

      it.each([
        ["1エンドの矢数", "arrowsPerEnd", "6", { arrowsPerEnd: 6 }],
        ["矢の総数", "totalArrows", "36", { totalArrows: 36 }],
      ])(
        "%sを入力して欄を離れると、その項目も持つ条件で取得し直す",
        async (_name, field, text, expected) => {
          // Given
          const user = await renderWithDistances([distanceRow(50)]);

          // When
          await user.type(distanceInput(0, field), text);
          await user.tab();

          // Then
          expect(fake.store.loadList).toHaveBeenLastCalledWith(
            conditionWith([distanceRow(50, expected)]),
            null,
            expect.any(Number),
          );
        },
      );

      it("1エンドの矢数を空にして欄を離れると、その項目だけnullにした条件で取得し直す", async () => {
        // Given
        const user = await renderWithDistances([
          distanceRow(50, { arrowsPerEnd: 6, totalArrows: 36 }),
        ]);

        // When
        await user.clear(distanceInput(0, "arrowsPerEnd"));
        await user.tab();

        // Then
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([distanceRow(50, { totalArrows: 36 })]),
          null,
          expect.any(Number),
        );
      });

      it("複数の行を足すと、全行をまとめて検証し、全行が正しくなった時点で、射つ順の行の配列で1回取得する", async () => {
        // Given
        const user = await renderWithDistances();
        await addDistanceRow(user, 0, "50");
        await user.click(screen.getByTestId("history-filter-distance-add"));
        await user.click(distanceInput(0, "distance"));
        await user.tab();
        const fetches = fake.store.loadList.mock.calls.length;

        // When
        await user.type(distanceInput(1, "distance"), "30");
        await user.tab();

        // Then
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches + 1);
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([distanceRow(50), distanceRow(30)]),
          null,
          expect.any(Number),
        );
      });

      it("2行目が空のまま1行目を入力して離れても、取得しない", async () => {
        // Given
        const user = await renderWithDistances();
        await user.click(screen.getByTestId("history-filter-distance-add"));
        await user.click(screen.getByTestId("history-filter-distance-add"));
        const fetches = fake.store.loadList.mock.calls.length;

        // When
        await user.type(distanceInput(0, "distance"), "50");
        await user.tab();

        // Then
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
      });

      it("入力の途中は検証も取得もせず、欄を離れたときに最後の値で1回だけ取得する", async () => {
        // Given
        const user = await renderWithDistances();
        await user.click(screen.getByTestId("history-filter-distance-add"));
        const fetches = fake.store.loadList.mock.calls.length;

        // When
        await user.type(distanceInput(0, "distance"), "50");
        const duringTyping = fake.store.loadList.mock.calls.length;
        await user.tab();

        // Then
        expect(duringTyping).toBe(fetches);
        expect(screen.queryByRole("alert")).toBeNull();
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches + 1);
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([distanceRow(50)]),
          null,
          expect.any(Number),
        );
      });

      it("反映済みと同じ値を入れ直して欄を離れても、取得し直さず、スケルトンにならない", async () => {
        // Given
        const user = await renderWithDistances([distanceRow(50)]);
        const fetches = fake.store.loadList.mock.calls.length;

        // When
        await user.clear(distanceInput(0, "distance"));
        await user.type(distanceInput(0, "distance"), "50");
        await user.tab();

        // Then
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
        expect(screen.queryByRole("status")).toBeNull();
        expect(shownNames()).toEqual(VARIED_NAMES);
      });

      it("行を削除すると、その場で残りの行を検証して取得し直す", async () => {
        // Given
        const user = await renderWithDistances([
          distanceRow(50),
          distanceRow(30),
        ]);

        // When
        await user.click(
          screen.getByTestId("history-filter-distance-0-remove"),
        );

        // Then
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([distanceRow(30)]),
          null,
          expect.any(Number),
        );
        expect(screen.queryByTestId("history-filter-distance-1")).toBeNull();
        expect(distanceInput(0, "distance")).toHaveValue("30");
      });

      it("最後の1行を削除すると、距離の構成を空の配列(指定なし)にして取得し直す", async () => {
        // Given
        const user = await renderWithDistances([distanceRow(50)]);

        // When
        await user.click(
          screen.getByTestId("history-filter-distance-0-remove"),
        );

        // Then
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          DEFAULT_HISTORY_CONDITION,
          null,
          expect.any(Number),
        );
        expect(screen.queryByTestId("history-filter-distance-0")).toBeNull();
      });

      it("行を削除しても、他の行の入力途中の文字は残る", async () => {
        // Given
        await renderWithDistances([distanceRow(50), distanceRow(30)]);
        draftDistance(1, "arrowsPerEnd", "6");

        // When
        fireEvent.click(screen.getByTestId("history-filter-distance-0-remove"));

        // Then
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([distanceRow(30, { arrowsPerEnd: 6 })]),
          null,
          expect.any(Number),
        );
        expect(distanceInput(0, "arrowsPerEnd")).toHaveValue("6");
      });

      it("取得中も、入力欄は同じ要素のまま入力途中の文字とフォーカスを保つ", async () => {
        // Given
        const user = await renderWithDistances([distanceRow(50)]);
        const totalArrows = distanceInput(0, "totalArrows");
        await user.type(distanceInput(0, "arrowsPerEnd"), "6");
        nextFetchPends();
        await user.click(totalArrows);

        // When
        await user.type(totalArrows, "3");

        // Then
        expect(screen.getByRole("status")).toBeInTheDocument();
        expect(distanceInput(0, "totalArrows")).toBe(totalArrows);
        expect(totalArrows).toHaveValue("3");
        expect(totalArrows).toHaveFocus();
        expect(distanceInput(0, "arrowsPerEnd")).toHaveValue("6");
      });

      it("数字でない文字を打っても、入力した文字がそのまま残る", async () => {
        // Given
        const user = await renderWithDistances();
        await user.click(screen.getByTestId("history-filter-distance-add"));

        // When
        await user.type(distanceInput(0, "distance"), "-1e");

        // Then
        expect(distanceInput(0, "distance")).toHaveValue("-1e");
      });

      it("距離の構成に一致するラウンドがなければ、該当するラウンドがないことだけを表示する", async () => {
        // Given
        const user = await renderWithDistances();
        await user.click(screen.getByTestId("history-filter-distance-add"));
        fetchResolves([]);

        // When
        await user.type(distanceInput(0, "distance"), "99{Enter}");

        // Then
        expect(
          await screen.findByText(roundsText("historyEmpty")),
        ).toBeInTheDocument();
        expect(screen.queryByText(roundsText("historyEnd"))).toBeNull();
        expect(screen.queryByRole("listitem")).toBeNull();
      });

      it("一致するラウンドは、サーバーが返した並びのまま表示する", async () => {
        // Given
        const user = await renderWithDistances();
        await user.click(screen.getByTestId("history-filter-distance-add"));

        // When
        await user.type(distanceInput(0, "distance"), "50{Enter}");

        // Then
        await waitFor(() => expect(shownNames()).toEqual(VARIED_NAMES));
      });
    });

    describe("的", () => {
      it("未指定の行で「的を加える」を押すと、保存した的の一覧がすべての種別・弓種で開き、選ぶとその的を持つ条件で取得し直す", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue(FACES);
        const user = await renderWithDistances([distanceRow(50)]);

        // When
        await user.click(
          screen.getByTestId("history-filter-distance-0-target-add"),
        );

        // Then
        for (const face of FACES) {
          expect(
            await screen.findByTestId(`target-face-option-${face.id}`),
          ).toBeVisible();
        }
        await user.click(
          screen.getByTestId(`target-face-option-${OUTDOOR_FACE.id}`),
        );
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([distanceRow(50, { targetFaceId: OUTDOOR_FACE.id })]),
          null,
          expect.any(Number),
        );
        expect(
          screen.getByTestId("history-filter-distance-0-target"),
        ).toBeVisible();
        expect(
          screen.queryByTestId("history-filter-distance-0-target-add"),
        ).toBeNull();
      });

      it("的を指定済みの行は、的の表示と「的を外す」を出し、押すと的をnullにして取得し直す", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue(FACES);
        const user = await renderWithDistances([
          distanceRow(50, { targetFaceId: OUTDOOR_FACE.id }),
        ]);

        // When
        await user.click(
          screen.getByTestId("history-filter-distance-0-target-clear"),
        );

        // Then
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([distanceRow(50)]),
          null,
          expect.any(Number),
        );
        expect(
          screen.getByTestId("history-filter-distance-0-target-add"),
        ).toBeVisible();
      });

      it("選んだ的の表示を押すと選び直せ、別の的を選ぶと取得し直す", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue(FACES);
        const user = await renderWithDistances([
          distanceRow(50, { targetFaceId: OUTDOOR_FACE.id }),
        ]);

        // When
        await user.click(
          screen.getByTestId("history-filter-distance-0-target"),
        );
        await user.click(
          await screen.findByTestId(`target-face-option-${INDOOR_FACE.id}`),
        );

        // Then
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([distanceRow(50, { targetFaceId: INDOOR_FACE.id })]),
          null,
          expect.any(Number),
        );
      });

      it("条件の種別・弓種を選んでいるとき、的の一覧は、その種別・弓種に当てはまる的だけで開く", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue(FACES);
        const user = await renderWithDistances([distanceRow(50)], {
          format: "indoor",
          bowType: "compound",
        });

        // When
        await user.click(
          screen.getByTestId("history-filter-distance-0-target-add"),
        );

        // Then
        expect(
          await screen.findByTestId(`target-face-option-${INDOOR_FACE.id}`),
        ).toBeVisible();
        expect(
          screen.queryByTestId(`target-face-option-${OUTDOOR_FACE.id}`),
        ).toBeNull();
      });

      it("的の一覧は、保存した一覧を読むだけで、履歴のために的を取得しない", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue(FACES);

        // When
        await renderWithDistances([distanceRow(50)]);

        // Then
        expect(procedures.fetching.savedTargetFaces).toHaveBeenCalled();
        expect(procedures.fetching.fetchPresets).not.toHaveBeenCalled();
      });

      it.each([
        ["保存した一覧が空", []],
        ["保存した一覧が読めない(null)", null],
      ])(
        "%sのとき、「的を加える」を押しても選べる的はなく、取得もエラーも起きない",
        async (_name, saved) => {
          // Given
          procedures.fetching.savedTargetFaces.mockReturnValue(saved);
          const user = await renderWithDistances([distanceRow(50)]);
          const fetches = fake.store.loadList.mock.calls.length;

          // When
          await user.click(
            screen.getByTestId("history-filter-distance-0-target-add"),
          );

          // Then
          expect(screen.queryAllByTestId(/^target-face-option-/)).toHaveLength(
            0,
          );
          expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
          expect(screen.queryByRole("alert")).toBeNull();
        },
      );

      it("記憶された的のIDが保存した一覧に無ければ、「的データを取得できません」を出し、その的の条件のまま取得に使う", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue([INDOOR_FACE]);
        const remembered = distanceRow(50, { targetFaceId: OUTDOOR_FACE.id });

        // When
        await renderWithDistances([remembered]);

        // Then
        const row = screen.getByTestId("history-filter-distance-0");
        expect(
          within(row).getByText(roundsText("targetFaceMissing")),
        ).toBeVisible();
        expect(fake.store.loadList).toHaveBeenCalledExactlyOnceWith(
          conditionWith([remembered]),
          null,
          expect.any(Number),
        );
      });

      it("保存した一覧に無い的の行も、「的を外す」で外せ、外すと取得し直す", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue([INDOOR_FACE]);
        const user = await renderWithDistances([
          distanceRow(50, { targetFaceId: OUTDOOR_FACE.id }),
        ]);

        // When
        await user.click(
          screen.getByTestId("history-filter-distance-0-target-clear"),
        );

        // Then
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([distanceRow(50)]),
          null,
          expect.any(Number),
        );
        expect(screen.queryByText(roundsText("targetFaceMissing"))).toBeNull();
      });
    });

    describe("不正な入力", () => {
      it.each([
        ["距離が空", { distance: "" }, "distance", "distanceInvalid"],
        [
          "1エンドの矢数が13",
          { distance: "30", arrowsPerEnd: "13" },
          "arrowsPerEnd",
          "arrowsPerEndInvalid",
        ],
        [
          "矢の総数が0",
          { distance: "30", totalArrows: "0" },
          "totalArrows",
          "totalArrowsInvalid",
        ],
      ])(
        "%sなら、取得せず、直前のカードと入力した文字を残し、不正な行の下にその原因の文言を出す",
        async (_name, drafts, leaving, error) => {
          // Given
          const user = await renderWithDistances([distanceRow(50)]);
          await user.click(screen.getByTestId("history-filter-distance-add"));
          const fetches = fake.store.loadList.mock.calls.length;

          // When
          for (const [field, value] of Object.entries(drafts)) {
            draftDistance(1, field, value);
          }
          leaveDistance(1, leaving);

          // Then
          const row = screen.getByTestId("history-filter-distance-1");
          expect(
            within(row).getByTestId(`history-filter-distance-error-1-${error}`),
          ).toHaveTextContent(
            roundsText(`historyDistanceError.${error as HistoryDistanceError}`),
          );
          expect(screen.getAllByRole("alert")).toHaveLength(1);
          expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
          expect(screen.queryByRole("status")).toBeNull();
          expect(shownNames()).toEqual(VARIED_NAMES);
          for (const [field, value] of Object.entries(drafts)) {
            expect(distanceInput(1, field)).toHaveValue(value);
          }
        },
      );

      it("複数の行・複数の項目が同時に不正なら、行ごと・原因ごとのエラーを、それぞれの行の下に出す", async () => {
        // Given
        const user = await renderWithDistances();
        await user.click(screen.getByTestId("history-filter-distance-add"));
        await user.click(screen.getByTestId("history-filter-distance-add"));

        // When
        draftDistance(1, "distance", "30");
        draftDistance(1, "arrowsPerEnd", "13");
        draftDistance(1, "totalArrows", "0");
        leaveDistance(1, "totalArrows");

        // Then
        const first = screen.getByTestId("history-filter-distance-0");
        const second = screen.getByTestId("history-filter-distance-1");
        expect(
          within(first).getByTestId(
            "history-filter-distance-error-0-distanceInvalid",
          ),
        ).toBeVisible();
        expect(
          within(second).getByTestId(
            "history-filter-distance-error-1-arrowsPerEndInvalid",
          ),
        ).toBeVisible();
        expect(
          within(second).getByTestId(
            "history-filter-distance-error-1-totalArrowsInvalid",
          ),
        ).toBeVisible();
        expect(
          within(second).queryByTestId(
            "history-filter-distance-error-1-distanceInvalid",
          ),
        ).toBeNull();
        expect(screen.getAllByRole("alert")).toHaveLength(3);
      });

      it("不正を直して欄を離れると、エラーが消え、反映して取得し直す", async () => {
        // Given
        const user = await renderWithDistances();
        await user.click(screen.getByTestId("history-filter-distance-add"));
        draftDistance(0, "distance", "0");
        leaveDistance(0, "distance");
        const fetches = fake.store.loadList.mock.calls.length;

        // When
        draftDistance(0, "distance", "50");
        leaveDistance(0, "distance");

        // Then
        expect(screen.queryByRole("alert")).toBeNull();
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches + 1);
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([distanceRow(50)]),
          null,
          expect.any(Number),
        );
      });

      it("不正な入力は、記憶に書かない", async () => {
        // Given
        const user = await renderWithDistances();
        await user.click(screen.getByTestId("history-filter-distance-add"));

        // When
        draftDistance(0, "distance", "0");
        leaveDistance(0, "distance");

        // Then
        expect(memory.stored()).toEqual({
          condition: DEFAULT_HISTORY_CONDITION,
          filterOpen: true,
        });
      });

      it("不正な行があるまま他の行の的を選んでも、取得せずエラーを残し、直した後に的も含めて反映する", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue(FACES);
        const user = await renderWithDistances([distanceRow(50)]);
        await user.click(screen.getByTestId("history-filter-distance-add"));
        draftDistance(1, "distance", "x");
        leaveDistance(1, "distance");
        const fetches = fake.store.loadList.mock.calls.length;

        // When
        await user.click(
          screen.getByTestId("history-filter-distance-0-target-add"),
        );
        await user.click(
          await screen.findByTestId(`target-face-option-${OUTDOOR_FACE.id}`),
        );
        const whileInvalid = fake.store.loadList.mock.calls.length;
        draftDistance(1, "distance", "30");
        leaveDistance(1, "distance");

        // Then
        expect(whileInvalid).toBe(fetches);
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([
            distanceRow(50, { targetFaceId: OUTDOOR_FACE.id }),
            distanceRow(30),
          ]),
          null,
          expect.any(Number),
        );
        expect(screen.queryByRole("alert")).toBeNull();
      });

      it("不正な行があるまま他の行を削除しても、取得せずエラーを残す", async () => {
        // Given
        const user = await renderWithDistances([
          distanceRow(50),
          distanceRow(30),
        ]);
        await user.click(screen.getByTestId("history-filter-distance-add"));
        draftDistance(2, "distance", "x");
        leaveDistance(2, "distance");
        const fetches = fake.store.loadList.mock.calls.length;

        // When
        await user.click(
          screen.getByTestId("history-filter-distance-0-remove"),
        );

        // Then
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
        expect(
          screen.getByTestId("history-filter-distance-error-1-distanceInvalid"),
        ).toBeVisible();
      });
    });

    describe("記憶と開閉", () => {
      it("距離の構成を変えると、その条件が記憶に書かれる", async () => {
        // Given
        const user = await renderWithDistances();
        await user.click(screen.getByTestId("history-filter-distance-add"));

        // When
        await user.type(distanceInput(0, "distance"), "50");
        await user.type(distanceInput(0, "arrowsPerEnd"), "6");
        await user.tab();

        // Then
        expect(memory.stored()).toEqual({
          condition: conditionWith([distanceRow(50, { arrowsPerEnd: 6 })]),
          filterOpen: true,
        });
      });

      it("記憶された距離の構成で取得し、欄を開いた状態でその行(距離・矢数・矢の総数・的)が入力に出て、閉じて開き直しても出る", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue(FACES);
        const remembered = [
          distanceRow(50, {
            arrowsPerEnd: 6,
            totalArrows: 36,
            targetFaceId: OUTDOOR_FACE.id,
          }),
          distanceRow(30),
        ];
        const user = await renderWithDistances(remembered);

        // When
        const shownFirst = [
          distanceInput(0, "distance"),
          distanceInput(0, "arrowsPerEnd"),
          distanceInput(0, "totalArrows"),
          distanceInput(1, "distance"),
        ].map((input) => (input as HTMLInputElement).value);
        await user.click(screen.getByTestId("history-controls-toggle"));
        await user.click(screen.getByTestId("history-controls-toggle"));

        // Then
        expect(fake.store.loadList).toHaveBeenCalledExactlyOnceWith(
          conditionWith(remembered),
          null,
          expect.any(Number),
        );
        expect(shownFirst).toEqual(["50", "6", "36", "30"]);
        expect(distanceInput(0, "totalArrows")).toHaveValue("36");
        expect(
          screen.getByTestId("history-filter-distance-0-target"),
        ).toBeVisible();
        expect(
          screen.getByTestId("history-filter-distance-1-target-add"),
        ).toBeVisible();
      });

      it("正しい下書きを入れたまま欄を閉じると、反映して取得し、閉じたことと距離の構成を記憶に書く", async () => {
        // Given
        const user = await renderWithDistances();
        await user.click(screen.getByTestId("history-filter-distance-add"));
        await user.type(distanceInput(0, "distance"), "50");

        // When
        await user.click(screen.getByTestId("history-controls-toggle"));

        // Then
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([distanceRow(50)]),
          null,
          expect.any(Number),
        );
        expect(screen.queryByTestId("history-controls")).toBeNull();
        expect(memory.stored()).toEqual({
          condition: conditionWith([distanceRow(50)]),
          filterOpen: false,
        });
      });

      it("不正な下書きを入れたまま欄を閉じると、取得せず表示も変えず、開き直すと反映済みの値が出てエラーは消えている", async () => {
        // Given
        const user = await renderWithDistances([distanceRow(50)]);
        await user.clear(distanceInput(0, "distance"));
        await user.type(distanceInput(0, "distance"), "x");
        const fetches = fake.store.loadList.mock.calls.length;

        // When
        await user.click(screen.getByTestId("history-controls-toggle"));
        await user.click(screen.getByTestId("history-controls-toggle"));

        // Then
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
        expect(shownNames()).toEqual(VARIED_NAMES);
        expect(distanceInput(0, "distance")).toHaveValue("50");
        expect(screen.queryByRole("alert")).toBeNull();
      });

      it("閉じている間は、距離の構成の値もエラーも示さず、距離の構成の条件は適用され続ける", async () => {
        // Given
        remember({
          condition: conditionWith([distanceRow(50)]),
          filterOpen: false,
        });
        fetchResolves(varied);

        // When
        renderHistory();
        await screen.findByText("夜練習");

        // Then
        expect(screen.queryByTestId("history-filter-distance-0")).toBeNull();
        expect(screen.queryByTestId("history-filter-distance-add")).toBeNull();
        expect(screen.queryByTestId("history-controls-reset")).toBeNull();
        expect(screen.queryByRole("alert")).toBeNull();
        expect(fake.store.loadList).toHaveBeenCalledExactlyOnceWith(
          conditionWith([distanceRow(50)]),
          null,
          expect.any(Number),
        );
      });
    });

    describe("リセット", () => {
      it("リセットすると、距離の構成の行・入力・エラーが消え、他の条件も既定に戻り、既定の条件で取得し直す", async () => {
        // Given
        const user = await renderWithDistances([distanceRow(50)], {
          format: "indoor",
          scoreMin: 300,
        });
        draftDistance(0, "distance", "x");
        leaveDistance(0, "distance");

        // When
        await user.click(screen.getByTestId("history-controls-reset"));

        // Then
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          DEFAULT_HISTORY_CONDITION,
          null,
          expect.any(Number),
        );
        expect(screen.queryByTestId("history-filter-distance-0")).toBeNull();
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.getByTestId("history-filter-distance-add")).toBeVisible();
        expect(memory.stored()).toEqual({
          condition: DEFAULT_HISTORY_CONDITION,
          filterOpen: true,
        });
      });

      it("正しい下書きを入れたままリセットすると、先に反映して取得し、その後に既定へ戻す", async () => {
        // Given
        const user = await renderWithDistances();
        await user.click(screen.getByTestId("history-filter-distance-add"));
        await user.type(distanceInput(0, "distance"), "50");

        // When
        await user.click(screen.getByTestId("history-controls-reset"));

        // Then
        expect(fake.store.loadList).toHaveBeenCalledWith(
          conditionWith([distanceRow(50)]),
          null,
          expect.any(Number),
        );
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          DEFAULT_HISTORY_CONDITION,
          null,
          expect.any(Number),
        );
        expect(screen.queryByTestId("history-filter-distance-0")).toBeNull();
      });

      it("不正な下書きを入れたままリセットしても、下書きとエラーが消え、既定の条件で取得し直す", async () => {
        // Given
        const user = await renderWithDistances();
        await user.click(screen.getByTestId("history-filter-distance-add"));
        await user.type(distanceInput(0, "distance"), "0");
        await user.tab();

        // When
        await user.click(screen.getByTestId("history-controls-reset"));

        // Then
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.queryByTestId("history-filter-distance-0")).toBeNull();
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          DEFAULT_HISTORY_CONDITION,
          null,
          expect.any(Number),
        );
      });
    });
  });

  describe("範囲のリセット", () => {
    it("リセットすると、範囲を含む全条件が既定に戻り、4つの入力が空になり、エラーが消え、既定の条件で取得し直す", async () => {
      // Given
      remember({
        condition: {
          ...DEFAULT_HISTORY_CONDITION,
          dateFrom: "2026-05-01",
          scoreMin: 300,
        },
        filterOpen: true,
      });
      fetchResolves(varied);
      renderHistory();
      await screen.findByText("夜練習");
      draftRange("scoreMax", "12a");
      leaveRange("scoreMax");
      const user = userEvent.setup();

      // When
      await user.click(screen.getByTestId("history-controls-reset"));

      // Then
      expect(fake.store.loadList).toHaveBeenLastCalledWith(
        DEFAULT_HISTORY_CONDITION,
        null,
        expect.any(Number),
      );
      for (const field of ["dateFrom", "dateTo", "scoreMin", "scoreMax"]) {
        expect(rangeInput(field)).toHaveValue("");
      }
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByTestId("history-controls")).toBeInTheDocument();
    });

    it("正しい下書きを入れたままリセットすると、先に反映して取得し、その後に既定へ戻す", async () => {
      // Given
      fetchResolves(varied);
      renderHistory();
      await screen.findByText("夜練習");
      const user = userEvent.setup();
      await user.type(rangeInput("scoreMin"), "300");

      // When
      await user.click(screen.getByTestId("history-controls-reset"));

      // Then
      expect(fake.store.loadList).toHaveBeenCalledWith(
        { ...DEFAULT_HISTORY_CONDITION, scoreMin: 300 },
        null,
        expect.any(Number),
      );
      expect(fake.store.loadList).toHaveBeenLastCalledWith(
        DEFAULT_HISTORY_CONDITION,
        null,
        expect.any(Number),
      );
      expect(rangeInput("scoreMin")).toHaveValue("");
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
          ...DEFAULT_HISTORY_CONDITION,

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
          ...DEFAULT_HISTORY_CONDITION,

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
          ...DEFAULT_HISTORY_CONDITION,

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
          ...DEFAULT_HISTORY_CONDITION,

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
