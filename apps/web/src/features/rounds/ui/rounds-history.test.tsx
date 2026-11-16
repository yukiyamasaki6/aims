import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { installFakeViewport } from "@/lib/viewport/fake-viewport-test-helpers";
import { createFakeHistoryViewMemory } from "../application/fake-history-view-memory-test-helpers";
import {
  DEFAULT_HISTORY_CONDITION,
  DEFAULT_HISTORY_VIEW_STATE,
  type HistoryCondition,
  type HistoryDistanceError,
  type HistoryDistanceRow,
  type HistoryRangeError,
  historyViewStateOf,
} from "../domain/history-view-state";
import { BOW_TYPE_OPTIONS, FORMAT_OPTIONS } from "../domain/round-constants";
import type {
  DistanceListItem,
  HistoryListItem,
  LoadedRoundsList,
  RoundListItem,
} from "../domain/round-list";
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
  distanceListItem,
  roundListItem,
  WIDE_CARD_METRICS,
} from "./round-stores-test-helpers";
import {
  RoundProceduresProvider,
  RoundsListStoreProvider,
  RoundWindowProvider,
} from "./rounds-context";
import { RoundsHistory } from "./rounds-history";
import { CardMetricsOverride } from "./use-card-fit";

const suspense = vi.hoisted(() => ({ pending: null as Promise<void> | null }));

vi.mock("next/navigation", async () => {
  const { fakeSearchParams: fake } = await import("./navigation-test-helpers");
  return {
    useSearchParams: () => {
      if (suspense.pending) throw suspense.pending;
      return fake.useSearchParams();
    },
  };
});

const roundsText = translatorFor("rounds");

// 取得、端末の列、削除の実物はそれぞれのテストで確かめる。ここでは偽の約束で渡す。
let fake: ReturnType<typeof createFakeRoundsListStore>;
let fakeWindow: ReturnType<typeof createFakeRoundWindow>;
let procedures: ReturnType<typeof createFakeRoundProcedures>;
let memory: ReturnType<typeof createFakeHistoryViewMemory>;
let viewport: ReturnType<typeof installFakeViewport>;
let intersection: ReturnType<typeof installFakeIntersectionObserver>;

// 続きの有無と起点は、既定では続きなし・最後の項目。
function loaded(
  items: HistoryListItem[],
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

// jsdomは幅を測れないため、全ての要素が入る測定値を渡す。
function WithCardMetrics({ children }: { children: ReactNode }) {
  return (
    <IntlTestProvider>
      <CardMetricsOverride value={WIDE_CARD_METRICS}>
        {children}
      </CardMetricsOverride>
    </IntlTestProvider>
  );
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
    { wrapper: WithCardMetrics },
  );
}

function roundItem(
  id: string,
  name: string,
  overrides: Partial<RoundListItem> = {},
): RoundListItem {
  return roundListItem({ id, name, total: 0, ...overrides });
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

function distanceItem(
  id: string,
  roundId: string,
  name: string,
  overrides: Partial<DistanceListItem> = {},
): DistanceListItem {
  return distanceListItem({ id, roundId, name, ...overrides });
}

// サーバーが返す距離単位の並び。ラウンドの並びも小計の順でもなく、同じラウンドの距離を離して置き、端末が並べ直さないことを見分けられる。
const distances: DistanceListItem[] = [
  distanceItem("d-1", "round-1", "午前練習", {
    distance: 30,
    total: 320,
  }),
  distanceItem("d-2", "round-2", "午後練習", { total: 280 }),
  distanceItem("d-3", "round-1", "午前練習", { total: 300 }),
];

function shownNames(): (string | undefined)[] {
  return screen
    .queryAllByRole("listitem", { hidden: true })
    .map(
      (listItem) =>
        varied.find((round) => listItem.textContent?.includes(round.name))
          ?.name,
    );
}

function remember(state: { condition: HistoryCondition }) {
  memory = createFakeHistoryViewMemory({ input: state.condition });
  procedures.historyViewMemory = memory.memory;
}

function fetchResolves(
  items: HistoryListItem[],
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

// 適用を押して、編集中の値の検証と確定を起こす。
function leaveRange(_name: string) {
  applyFilter();
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
    targetFaceId: null,
    ...overrides,
  };
}

// 距離のダイアログの入力欄。同時に開くのは1つだけである。
function dialogInput(field: "distance" | "arrowsPerEnd") {
  return screen.getByTestId(`history-distance-dialog-${field}`);
}

// 距離のダイアログを閉じるまで待つ。
async function waitForDistanceDialogClosed() {
  await waitFor(() =>
    expect(screen.queryByTestId("history-distance-dialog-confirm")).toBeNull(),
  );
}

// 開いているダイアログに距離(と1エンドの矢数)を入れて、確定のボタンを押し、閉じるまで待つ。
async function confirmDistanceDialog(
  user: ReturnType<typeof userEvent.setup>,
  distance: string,
  arrowsPerEnd = "",
) {
  await user.type(dialogInput("distance"), distance);
  if (arrowsPerEnd !== "") {
    await user.type(dialogInput("arrowsPerEnd"), arrowsPerEnd);
  }
  await user.click(screen.getByTestId("history-distance-dialog-confirm"));
  await waitForDistanceDialogClosed();
}

// ラウンド構成に「距離を追加」で1行足す(適用はしない)。
async function addDistance(
  user: ReturnType<typeof userEvent.setup>,
  distance: string,
  arrowsPerEnd = "",
) {
  await user.click(screen.getByTestId("history-filter-distance-add"));
  await confirmDistanceDialog(user, distance, arrowsPerEnd);
}

// 距離単位の「距離を選択」で距離を選ぶ(適用はしない)。
async function selectDistance(
  user: ReturnType<typeof userEvent.setup>,
  distance: string,
  arrowsPerEnd = "",
) {
  await user.click(screen.getByTestId("history-filter-distance-select"));
  await confirmDistanceDialog(user, distance, arrowsPerEnd);
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
  viewport = installFakeViewport();
  fake = createFakeRoundsListStore();
  fake.store.loadList.mockReturnValue(new Promise(() => {}));
  procedures = createFakeRoundProcedures();
  remember({ condition: DEFAULT_HISTORY_CONDITION });
  // offlineの結果が返る状況は通信が切れている(切れていないと、すぐ再取得する)。
  procedures.goOffline();
  fakeWindow = createFakeRoundWindow();
  fakeWindow.setLocal({ inProgress: [] });
  followReplaceState();
  // jsdomには交差の判定が無いため、偽物で末尾が近づいたことを起こす。
  intersection = installFakeIntersectionObserver();
});

afterEach(() => {
  cleanup();
  viewport.restore();
  suspense.pending = null;
  fakeSearchParams.reset();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// 種別・弓種の選択欄を開き、名前の選択肢を選ぶ。
async function chooseFilter(
  user: ReturnType<typeof userEvent.setup>,
  testId: string,
  optionName: string,
) {
  await user.click(screen.getByTestId(testId));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

// 選択欄のトリガーに表示されている選択中の項目。
function selectedOf(testId: string) {
  return screen.getByTestId(testId).textContent;
}

// 右上のフィルターのアイコンを押して、パネルを開く。
async function openFilter(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("history-controls-toggle"));
  await screen.findByRole("region", { name: roundsText("historyFilterTitle") });
}

// 一覧を表示してから、パネルを開く。
async function renderOpenedHistory() {
  fetchResolves(varied);
  renderHistory();
  await screen.findByText("夜練習");
  const user = userEvent.setup();
  await openFilter(user);
  return user;
}

// 操作行はパネルの中に1つだけある。
function filterAction(action: "apply" | "reset") {
  return within(
    screen.getByRole("region", { name: roundsText("historyFilterTitle") }),
  ).getByTestId(`history-controls-${action}`);
}

// 適用を押す。
function applyFilter() {
  fireEvent.click(filterAction("apply"));
}

const FORMAT_TEST_ID = "history-filter-format";
const BOW_TYPE_TEST_ID = "history-filter-bow-type";
const DATE_DIRECTION_TEST_ID = "history-sort-date-direction";
const SCORE_DIRECTION_TEST_ID = "history-sort-score-direction";

describe("RoundsHistory", () => {
  describe("指定された日本語の見出し", () => {
    it.each([
      ["取得中", () => {}, () => screen.findByRole("status")],
      [
        "空",
        () => fetchResolves([]),
        () => screen.findByText(roundsText("historyEmpty")),
      ],
      [
        "成功",
        () => fetchResolves(completed),
        () => screen.findByText("午前練習"),
      ],
      [
        "通信失敗",
        () =>
          fake.store.loadList.mockResolvedValue({
            status: "error",
            reason: "failed",
          }),
        () => screen.findByRole("alert"),
      ],
      [
        "オフライン",
        () => fake.store.loadList.mockResolvedValue({ status: "offline" }),
        () => screen.findByText(roundsText("fetchOffline")),
      ],
    ] as const)(
      "%sでも見出しの指定された日本語「点数一覧」と対応する本文を表示する",
      async (_state, prepare, body) => {
        // Given
        prepare();

        // When
        renderHistory();

        // Then
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
          /^点数一覧$/,
        );
        expect(await body()).toBeVisible();
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
          /^点数一覧$/,
        );
      },
    );

    it("Suspense待機中も指定された日本語「点数一覧」の見出しを表示する", () => {
      // Given
      suspense.pending = new Promise(() => {});

      // When
      renderHistory();

      // Then
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        /^点数一覧$/,
      );
      expect(
        screen.queryByRole("button", {
          name: roundsText("historyFilterTitle"),
        }),
      ).toBeNull();
      expect(fake.store.loadList).not.toHaveBeenCalled();
    });

    it("Suspense待機の解除後も指定された日本語「点数一覧」の見出しを保つ", async () => {
      // Given
      const pending = Promise.withResolvers<void>();
      suspense.pending = pending.promise;
      fetchResolves(completed);
      renderHistory();
      const headingWhilePending = screen.getByRole("heading", { level: 1 });
      const titleWhilePending = headingWhilePending.textContent;

      // When
      await act(async () => {
        suspense.pending = null;
        pending.resolve();
      });

      // Then
      expect(titleWhilePending).toBe("点数一覧");
      expect(await screen.findByText("午前練習")).toBeVisible();
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        /^点数一覧$/,
      );
    });
  });

  describe("非モーダルの編集セッション", () => {
    it("開閉状態と操作対象のregionをヘッダーから参照できる", async () => {
      // Given
      fetchResolves(varied);
      renderHistory();
      await screen.findByText("夜練習");
      const toggle = screen.getByTestId("history-controls-toggle");
      const expandedBefore = toggle.getAttribute("aria-expanded");

      // When
      fireEvent.click(toggle);

      // Then
      expect(expandedBefore).toBe("false");
      const region = screen.getByRole("region", {
        name: roundsText("historyFilterTitle"),
      });
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(toggle).toHaveAttribute("aria-controls", region.id);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it.each([
      ["縦長", false],
      ["横長", true],
    ])(
      "%sでヘッダーのフィルターを押すと未適用値とエラーを破棄してヘッダーへ戻す",
      async (_orientation, landscape) => {
        // Given
        viewport.setLandscape(landscape);
        const user = await renderOpenedHistory();
        draftRange("scoreMin", "9");
        draftRange("scoreMax", "1");
        applyFilter();
        const requests = [...fake.store.loadList.mock.calls];
        const stored = memory.stored();
        const toggle = screen.getByTestId("history-controls-toggle");

        // When
        await user.click(toggle);
        const focused = document.activeElement;
        await openFilter(user);

        // Then
        expect(focused).toBe(toggle);
        expect(rangeInput("scoreMin")).toHaveValue("");
        expect(screen.queryByRole("alert")).toBeNull();
        expect(fake.store.loadList.mock.calls).toEqual(requests);
        expect(memory.stored()).toEqual(stored);
      },
    );

    it("パネルには、リセットと検索の操作行が1組だけあり、先頭の条件より前に並ぶ", async () => {
      // Given
      await renderOpenedHistory();

      // When
      const resets = screen.getAllByTestId("history-controls-reset");
      const applies = screen.getAllByTestId("history-controls-apply");

      // Then
      expect(resets).toHaveLength(1);
      expect(applies).toHaveLength(1);
      expect(
        resets[0].compareDocumentPosition(applies[0]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        applies[0].compareDocumentPosition(rangeInput("dateFrom")) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("操作行の表示は、指定された日本語「リセット」と「検索」である", async () => {
      // Given
      await renderOpenedHistory();

      // When
      const reset = filterAction("reset");
      const search = filterAction("apply");

      // Then
      expect(reset).toHaveTextContent(/^リセット$/);
      expect(search).toHaveTextContent(/^検索$/);
    });

    it.each([
      ["入力欄", () => rangeInput("scoreMin")],
      ["操作行", () => filterAction("apply")],
    ])(
      "パネルの%s内のEscで閉じてヘッダーへフォーカスを戻す",
      async (_place, target) => {
        // Given
        await renderOpenedHistory();
        draftRange("scoreMin", "19");

        // When
        fireEvent.keyDown(target(), { key: "Escape" });

        // Then
        expect(
          screen.queryByRole("region", {
            name: roundsText("historyFilterTitle"),
          }),
        ).toBeNull();
        expect(screen.getByTestId("history-controls-toggle")).toHaveFocus();
      },
    );

    it("ヘッダーの操作内のEscでは閉じず、編集中の条件とエラーを保つ", async () => {
      // Given
      await renderOpenedHistory();
      draftRange("scoreMin", "9");
      draftRange("scoreMax", "1");
      applyFilter();
      const toggle = screen.getByTestId("history-controls-toggle");

      // When
      fireEvent.keyDown(toggle, { key: "Escape" });

      // Then
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(rangeInput("scoreMin")).toHaveValue("9");
      expect(
        screen.getByTestId("history-filter-error-scoreOrder"),
      ).toBeInTheDocument();
    });

    it("一覧内のEscと外側クリックでは下書きとエラーを保つ", async () => {
      // Given
      await renderOpenedHistory();
      draftRange("scoreMin", "9");
      draftRange("scoreMax", "1");
      applyFilter();
      const requests = [...fake.store.loadList.mock.calls];
      const main = screen.getByRole("main");

      // When
      fireEvent.click(main);
      fireEvent.keyDown(main, { key: "Escape" });

      // Then
      expect(
        screen.getByRole("region", { name: roundsText("historyFilterTitle") }),
      ).toBeInTheDocument();
      expect(rangeInput("scoreMin")).toHaveValue("9");
      expect(
        screen.getByTestId("history-filter-error-scoreOrder"),
      ).toBeInTheDocument();
      expect(fake.store.loadList.mock.calls).toEqual(requests);
    });

    it("処理済みのEscでは外側を閉じない", async () => {
      // Given
      await renderOpenedHistory();
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      event.preventDefault();

      // When
      fireEvent(rangeInput("scoreMin"), event);

      // Then
      expect(
        screen.getByRole("region", { name: roundsText("historyFilterTitle") }),
      ).toBeInTheDocument();
    });

    it.each(["Enter", "Tab"])(
      "エラー後の修正と%sで検証・保存・取得・閉鎖を起こさない",
      async (key) => {
        // Given
        const user = await renderOpenedHistory();
        draftRange("scoreMin", "9");
        draftRange("scoreMax", "1");
        applyFilter();
        const requests = [...fake.store.loadList.mock.calls];
        const stored = memory.stored();
        rangeInput("scoreMin").focus();

        // When
        draftRange("scoreMin", "0");
        await user.keyboard(`{${key}}`);

        // Then
        expect(rangeInput("scoreMin")).toHaveValue("0");
        expect(
          screen.getByTestId("history-filter-error-scoreOrder"),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("region", {
            name: roundsText("historyFilterTitle"),
          }),
        ).toBeInTheDocument();
        expect(fake.store.loadList.mock.calls).toEqual(requests);
        expect(memory.stored()).toEqual(stored);
      },
    );

    it("正しい値へ修正して適用すると閉じて条件を確定する", async () => {
      // Given
      await renderOpenedHistory();
      draftRange("scoreMin", "9");
      draftRange("scoreMax", "1");
      applyFilter();
      draftRange("scoreMin", "0");

      // When
      applyFilter();

      // Then
      expect(
        screen.queryByRole("region", {
          name: roundsText("historyFilterTitle"),
        }),
      ).toBeNull();
      expect(memory.stored().input).toMatchObject({ scoreMin: 0, scoreMax: 1 });
      expect(fake.store.loadList).toHaveBeenLastCalledWith(
        expect.objectContaining({ scoreMin: 0, scoreMax: 1 }),
        null,
        expect.any(Number),
      );
      expect(screen.getByTestId("history-controls-toggle")).toHaveFocus();
    });

    it.each(["ok", "error"])(
      "保留中の一覧取得が%sになっても編集文字とエラーを維持する",
      async (status) => {
        // Given
        const pending = Promise.withResolvers<unknown>();
        fake.store.loadList.mockReturnValue(pending.promise);
        renderHistory();
        const user = userEvent.setup();
        await openFilter(user);
        draftRange("scoreMin", "-");
        applyFilter();

        // When
        await act(async () =>
          pending.resolve(
            status === "ok"
              ? { status, data: loaded(varied) }
              : { status, reason: "failed" },
          ),
        );

        // Then
        expect(
          screen.getByRole("region", {
            name: roundsText("historyFilterTitle"),
          }),
        ).toBeInTheDocument();
        expect(rangeInput("scoreMin")).toHaveValue("-");
        expect(
          screen.getByTestId("history-filter-error-scoreInvalid"),
        ).toBeInTheDocument();
        expect(memory.stored()).toEqual(DEFAULT_HISTORY_VIEW_STATE);
      },
    );

    it("再試行は適用済み条件を使い下書きとエラーを維持する", async () => {
      // Given
      fake.store.loadList.mockResolvedValue({
        status: "error",
        reason: "failed",
      });
      renderHistory();
      const user = userEvent.setup();
      await screen.findByRole("button", { name: roundsText("fetchRetry") });
      await openFilter(user);
      draftRange("scoreMin", "-");
      applyFilter();
      fetchResolves(varied);

      // When
      await user.click(
        screen.getByRole("button", { name: roundsText("fetchRetry") }),
      );

      // Then
      expect(await screen.findByText("夜練習")).toBeInTheDocument();
      expect(fake.store.loadList).toHaveBeenLastCalledWith(
        DEFAULT_HISTORY_CONDITION,
        null,
        expect.any(Number),
      );
      expect(rangeInput("scoreMin")).toHaveValue("-");
      expect(
        screen.getByTestId("history-filter-error-scoreInvalid"),
      ).toBeInTheDocument();
    });

    it.each(["apply", "reset"] as const)(
      "操作行の%sにフォーカスして縦長と横長へ回転しても、フォーカスも開閉も動かない",
      async (action) => {
        // Given
        await renderOpenedHistory();
        const target = filterAction(action);
        target.focus();
        const toggle = screen.getByTestId("history-controls-toggle");

        // When
        act(() => viewport.setLandscape(true));
        const horizontal = document.activeElement;
        act(() => viewport.setLandscape(false));

        // Then
        expect(horizontal).toBe(target);
        expect(target).toHaveFocus();
        expect(toggle).toHaveAttribute("aria-expanded", "true");
        expect(filterAction(action)).toBe(target);
      },
    );

    describe("検索後の挙動は検索を押した時点の向きで決まる", () => {
      it("横長で有効な変更を検索すると、閉じず、入力値とフォーカスを保ち、条件を確定して先頭から取得する", async () => {
        // Given
        viewport.setLandscape(true);
        const user = await renderOpenedHistory();
        draftRange("scoreMin", "5");

        // When
        await user.click(filterAction("apply"));

        // Then
        expect(
          screen.getByRole("region", {
            name: roundsText("historyFilterTitle"),
          }),
        ).toBeInTheDocument();
        expect(rangeInput("scoreMin")).toHaveValue("5");
        expect(filterAction("apply")).toHaveFocus();
        expect(memory.stored().input.scoreMin).toBe(5);
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          expect.objectContaining({ scoreMin: 5 }),
          null,
          expect.any(Number),
        );
        expect(screen.getByTestId("history-controls-active")).toBeVisible();
      });

      it("横長で検索した後に別の値へ編集し、検索に残ったフォーカスのままEnterで再度検索できる", async () => {
        // Given
        viewport.setLandscape(true);
        const user = await renderOpenedHistory();
        draftRange("scoreMin", "5");
        await user.click(filterAction("apply"));
        draftRange("scoreMin", "7");

        // When
        await user.keyboard("{Enter}");

        // Then
        expect(filterAction("apply")).toHaveFocus();
        expect(memory.stored().input.scoreMin).toBe(7);
        expect(rangeInput("scoreMin")).toHaveValue("7");
      });

      it("横長で検索した後のEscは、その後の未適用の変更を破棄して閉じ、再表示は直近に検索した条件で始まる", async () => {
        // Given
        viewport.setLandscape(true);
        const user = await renderOpenedHistory();
        draftRange("scoreMin", "5");
        await user.click(filterAction("apply"));
        draftRange("scoreMin", "8");

        // When
        fireEvent.keyDown(rangeInput("scoreMin"), { key: "Escape" });
        await openFilter(user);

        // Then
        expect(rangeInput("scoreMin")).toHaveValue("5");
        expect(memory.stored().input.scoreMin).toBe(5);
      });

      it("横長で不正な値を検索すると、エラーを示して開いたままで、一覧も記憶も変えない", async () => {
        // Given
        viewport.setLandscape(true);
        const user = await renderOpenedHistory();
        const requests = [...fake.store.loadList.mock.calls];
        const stored = memory.stored();
        draftRange("scoreMin", "9");
        draftRange("scoreMax", "1");

        // When
        await user.click(filterAction("apply"));

        // Then
        expect(
          screen.getByTestId("history-filter-error-scoreOrder"),
        ).toBeInTheDocument();
        expect(rangeInput("scoreMin")).toHaveValue("9");
        expect(fake.store.loadList.mock.calls).toEqual(requests);
        expect(memory.stored()).toEqual(stored);
      });

      it("横長で条件を変えずに検索すると、開いたままで表示済みの一覧を維持し、取得し直さない", async () => {
        // Given
        viewport.setLandscape(true);
        const user = await renderOpenedHistory();
        const fetches = fake.store.loadList.mock.calls.length;

        // When
        await user.click(filterAction("apply"));

        // Then
        expect(
          screen.getByRole("region", {
            name: roundsText("historyFilterTitle"),
          }),
        ).toBeInTheDocument();
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
        expect(screen.getByText("夜練習")).toBeInTheDocument();
        expect(screen.queryByRole("status")).toBeNull();
      });

      it("横長でリセットして検索すると、既定の条件を確定して開いたままで、適用中の印が消える", async () => {
        // Given
        viewport.setLandscape(true);
        remember({
          condition: { ...DEFAULT_HISTORY_CONDITION, format: "indoor" },
        });
        const user = await renderOpenedHistory();
        await user.click(filterAction("reset"));

        // When
        await user.click(filterAction("apply"));

        // Then
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          DEFAULT_HISTORY_CONDITION,
          null,
          expect.any(Number),
        );
        expect(screen.queryByTestId("history-controls-active")).toBeNull();
        expect(
          screen.getByRole("region", {
            name: roundsText("historyFilterTitle"),
          }),
        ).toBeInTheDocument();
      });

      it("縦長から横長へ変えただけでは開閉もフォーカスも変わらず、変えた後の検索は閉じず検索にフォーカスが残る", async () => {
        // Given
        const user = await renderOpenedHistory();
        draftRange("scoreMin", "5");
        const search = filterAction("apply");
        search.focus();

        // When
        act(() => viewport.setLandscape(true));
        const rotated = document.activeElement;
        const expandedAfterRotation = screen
          .getByTestId("history-controls-toggle")
          .getAttribute("aria-expanded");
        await user.click(search);

        // Then
        expect(rotated).toBe(search);
        expect(expandedAfterRotation).toBe("true");
        expect(
          screen.getByRole("region", {
            name: roundsText("historyFilterTitle"),
          }),
        ).toBeInTheDocument();
        expect(search).toHaveFocus();
        expect(memory.stored().input.scoreMin).toBe(5);
      });

      it("横長から縦長へ変えた後の検索は閉じ、フォーカスがヘッダーのフィルターへ戻る", async () => {
        // Given
        viewport.setLandscape(true);
        const user = await renderOpenedHistory();
        draftRange("scoreMin", "5");
        act(() => viewport.setLandscape(false));

        // When
        await user.click(filterAction("apply"));

        // Then
        expect(
          screen.queryByRole("region", {
            name: roundsText("historyFilterTitle"),
          }),
        ).toBeNull();
        expect(screen.getByTestId("history-controls-toggle")).toHaveFocus();
        expect(memory.stored().input.scoreMin).toBe(5);
      });

      it("縦長で検索すると閉じてフォーカスがヘッダーのフィルターへ戻る", async () => {
        // Given
        const user = await renderOpenedHistory();
        draftRange("scoreMin", "5");

        // When
        await user.click(filterAction("apply"));

        // Then
        expect(
          screen.queryByRole("region", {
            name: roundsText("historyFilterTitle"),
          }),
        ).toBeNull();
        expect(screen.getByTestId("history-controls-toggle")).toHaveFocus();
      });
    });

    it("入力中のEnterでは検索せず、一覧・記憶・印を変えず、閉じず、エラー検証も起こさない", async () => {
      // Given
      const user = await renderOpenedHistory();
      const requests = [...fake.store.loadList.mock.calls];
      const stored = memory.stored();
      await user.type(rangeInput("scoreMin"), "9");
      draftRange("scoreMax", "1");

      // When
      await user.type(rangeInput("scoreMin"), "{Enter}");

      // Then
      expect(
        screen.getByRole("region", { name: roundsText("historyFilterTitle") }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByTestId("history-controls-active")).toBeNull();
      expect(fake.store.loadList.mock.calls).toEqual(requests);
      expect(memory.stored()).toEqual(stored);
    });

    it("回転しても入力のフォーカスと下書きを保ち取得も保存もしない", async () => {
      // Given
      await renderOpenedHistory();
      vi.useFakeTimers();
      draftRange("scoreMin", "-");
      rangeInput("scoreMin").focus();
      const requests = [...fake.store.loadList.mock.calls];
      const stored = memory.stored();

      // When
      act(() => {
        viewport.setLandscape(true);
        vi.advanceTimersByTime(20);
      });

      // Then
      expect(rangeInput("scoreMin")).toHaveFocus();
      expect(rangeInput("scoreMin")).toHaveValue("-");
      expect(fake.store.loadList.mock.calls).toEqual(requests);
      expect(memory.stored()).toEqual(stored);
    });

    it("動きを減らす設定で閉じると待機せずフォームを破棄する", async () => {
      // Given
      viewport.restore();
      viewport = installFakeViewport({ reducedMotion: true });
      await renderOpenedHistory();
      vi.useFakeTimers();
      draftRange("scoreMin", "99");

      // When
      fireEvent.click(screen.getByTestId("history-controls-toggle"));
      act(() => vi.advanceTimersByTime(0));

      // Then
      expect(screen.queryByTestId("history-controls")).toBeNull();
      expect(screen.getByTestId("history-controls-toggle")).toHaveFocus();
    });

    it("格納中の古いフォームからsubmitが届いても条件を確定しない", async () => {
      // Given
      await renderOpenedHistory();
      vi.useFakeTimers();
      draftRange("scoreMin", "123");
      const form = screen.getByTestId("history-controls");
      fireEvent.click(screen.getByTestId("history-controls-toggle"));
      const requests = [...fake.store.loadList.mock.calls];
      const stored = memory.stored();

      // When
      fireEvent.submit(form);

      // Then
      expect(memory.stored()).toEqual(stored);
      expect(fake.store.loadList.mock.calls).toEqual(requests);
      expect(screen.getByTestId("history-controls-toggle")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });

    it("格納終了イベントがなくても編集を破棄し新しい編集を始められる", async () => {
      // Given
      await renderOpenedHistory();
      vi.useFakeTimers();
      draftRange("scoreMin", "19");
      fireEvent.click(screen.getByTestId("history-controls-toggle"));

      // When
      act(() => vi.advanceTimersByTime(200));
      fireEvent.click(screen.getByTestId("history-controls-toggle"));

      // Then
      expect(rangeInput("scoreMin")).toHaveValue("");
      expect(
        screen.getByRole("region", { name: roundsText("historyFilterTitle") }),
      ).toBeInTheDocument();
    });

    it("格納途中に開き直すと古い編集と終了通知が新しい編集を壊さない", async () => {
      // Given
      await renderOpenedHistory();
      vi.useFakeTimers();
      draftRange("scoreMin", "19");
      const timers = vi.spyOn(window, "setTimeout");
      fireEvent.click(screen.getByTestId("history-controls-toggle"));
      const oldCollapse = timers.mock.calls.findLast(
        (call) => call[1] === 200,
      )?.[0];
      fireEvent.click(screen.getByTestId("history-controls-toggle"));
      const reopenedScoreMin = (rangeInput("scoreMin") as HTMLInputElement)
        .value;
      draftRange("scoreMin", "25");

      // When
      act(() => {
        if (typeof oldCollapse !== "function")
          throw new Error("Missing collapse notification");
        oldCollapse();
        vi.advanceTimersByTime(200);
      });
      applyFilter();

      // Then
      expect(reopenedScoreMin).toBe("");
      expect(memory.stored().input.scoreMin).toBe(25);
      expect(fake.store.loadList).toHaveBeenLastCalledWith(
        expect.objectContaining({ scoreMin: 25 }),
        null,
        expect.any(Number),
      );
    });
  });

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
      expect(screen.getByText("2026/09/15")).toBeInTheDocument();
      expect(screen.getByText("午前練習").closest("li")?.textContent).toMatch(
        /300$/,
      );
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("見出し「履歴」のレベル1がヘッダーにあり、ラウンドの開始ボタンは持たない", async () => {
      // Given
      fetchResolves(completed);

      // When
      renderHistory();
      await screen.findByText("午前練習");

      // Then
      const heading = screen.getByRole("heading", {
        level: 1,
        name: roundsText("historyTitle"),
      });
      expect(heading.closest("header")).not.toBeNull();
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.queryByTestId("new-round-fab")).toBeNull();
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

  describe("フィルターのパネル", () => {
    const toggle = () => screen.getByTestId("history-controls-toggle");
    const panel = () =>
      screen.queryByRole("region", { name: roundsText("historyFilterTitle") });
    const mark = () => screen.queryByTestId("history-controls-active");
    const optionNames = () =>
      screen.getAllByRole("option").map((o) => o.textContent);

    // 比較は文書上の位置。先に現れる要素が、後ろの要素より前にある。
    const isBefore = (first: HTMLElement, second: HTMLElement) =>
      Boolean(
        first.compareDocumentPosition(second) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );

    describe("開閉と印", () => {
      it("初期はパネルが無く、名前「フィルター」のアイコンのボタンがあり、印は無い", async () => {
        // Given
        fetchResolves(varied);

        // When
        renderHistory();
        await screen.findByText("夜練習");

        // Then
        expect(panel()).toBeNull();
        expect(mark()).toBeNull();
        expect(
          screen.getByRole("button", {
            name: roundsText("historyFilterTitle"),
          }),
        ).toBe(toggle());
      });

      it("アイコンを押すと、名前「フィルター」のregionが開く", async () => {
        // Given
        fetchResolves(varied);
        const user = userEvent.setup();
        renderHistory();
        await screen.findByText("夜練習");

        // When
        await openFilter(user);

        // Then
        expect(
          screen.getByRole("region", {
            name: roundsText("historyFilterTitle"),
          }),
        ).toBeInTheDocument();
        expect(screen.queryByText("並べ替え・絞り込み")).toBeNull();
      });

      it("保存された入力値が既定でなければ、閉じていてもアイコンに「適用中」の印が出る", async () => {
        // Given
        remember({
          condition: { ...DEFAULT_HISTORY_CONDITION, format: "indoor" },
        });
        fetchResolves(varied);

        // When
        renderHistory();
        await screen.findByText("夜練習");

        // Then
        expect(panel()).toBeNull();
        expect(mark()).toHaveTextContent(roundsText("historyFilterActive"));
      });

      it("非既定の条件から既定に戻して適用すると印が消える", async () => {
        // Given
        fetchResolves(varied);
        const user = userEvent.setup();
        renderHistory();
        await screen.findByText("夜練習");
        await openFilter(user);
        await chooseFilter(
          user,
          FORMAT_TEST_ID,
          roundsText("formatOption.indoor"),
        );

        applyFilter();

        await waitFor(() => expect(panel()).toBeNull());
        const markAfterNonDefault = mark();
        await openFilter(user);
        await chooseFilter(
          user,
          FORMAT_TEST_ID,
          roundsText("historyFilterNone"),
        );

        // When
        applyFilter();

        // Then
        expect(markAfterNonDefault).not.toBeNull();
        await waitFor(() => expect(panel()).toBeNull());
        expect(mark()).toBeNull();
      });

      it("編集中の値を変えただけでは、印は出ない", async () => {
        // Given
        fetchResolves(varied);
        const user = userEvent.setup();
        renderHistory();
        await screen.findByText("夜練習");
        await openFilter(user);

        // When
        await chooseFilter(
          user,
          FORMAT_TEST_ID,
          roundsText("formatOption.indoor"),
        );

        // Then
        expect(mark()).toBeNull();
      });

      it("単位がラウンドのとき、絞り込む距離の入力だけが既定でない保存値でも、印は出ない", async () => {
        // Given
        remember({
          condition: {
            ...DEFAULT_HISTORY_CONDITION,
            unit: "round",
            distanceRow: distanceRow(50),
          },
        });
        fetchResolves(varied);

        // When
        renderHistory();
        await screen.findByText("夜練習");

        // Then
        expect(mark()).toBeNull();
      });
    });

    describe("閉じるボタンと展開中の漏斗", () => {
      const orientations = [
        ["縦長", false],
        ["横長", true],
      ] as const;
      const closeButton = () =>
        within(
          screen.getByRole("region", {
            name: roundsText("historyFilterTitle"),
          }),
        ).getByRole("button", { name: roundsText("historyFilterClose") });
      // 見た目の出力は、開閉の状態そのものである`aria-expanded`を除いたクラスで比べる。
      const funnelLook = () => toggle().className;

      it.each(orientations)(
        "%sで開くと、操作行にフォーム外の通常のボタン「閉じる」が1つだけあり、リセット・検索の後ろに並ぶ",
        async (_orientation, landscape) => {
          // Given
          viewport.setLandscape(landscape);

          // When
          await renderOpenedHistory();

          // Then
          const region = screen.getByRole("region", {
            name: roundsText("historyFilterTitle"),
          });
          expect(
            within(region).getAllByRole("button", {
              name: roundsText("historyFilterClose"),
            }),
          ).toHaveLength(1);
          const close = closeButton();
          expect(close).toHaveAttribute("type", "button");
          expect(close.closest("form")).toBeNull();
          expect(close).not.toHaveAttribute("form");
          expect(isBefore(filterAction("reset"), filterAction("apply"))).toBe(
            true,
          );
          expect(isBefore(filterAction("apply"), close)).toBe(true);
        },
      );

      it("閉じるボタンの名前は「閉じる」で、図柄(✖)は名前を持たない", async () => {
        // Given
        await renderOpenedHistory();

        // When
        const close = closeButton();

        // Then
        expect(close).toHaveAccessibleName("閉じる");
        expect(close.querySelector("svg")).toHaveAttribute(
          "aria-hidden",
          "true",
        );
        expect(close.querySelector("svg")).not.toHaveAccessibleName();
      });

      it.each(orientations)(
        "%sで閉じるボタンを押すと、未適用の変更とエラーを破棄して閉じ、漏斗へフォーカスが戻り、取得も記憶もしない",
        async (_orientation, landscape) => {
          // Given
          viewport.setLandscape(landscape);
          const user = await renderOpenedHistory();
          draftRange("scoreMin", "9");
          draftRange("scoreMax", "1");
          applyFilter();
          draftRange("scoreMax", "7");
          const requests = [...fake.store.loadList.mock.calls];
          const stored = memory.stored();

          // When
          await user.click(closeButton());

          // Then
          expect(panel()).toBeNull();
          expect(toggle()).toHaveFocus();
          expect(toggle()).toHaveAttribute("aria-expanded", "false");
          expect(mark()).toBeNull();
          expect(fake.store.loadList.mock.calls).toEqual(requests);
          expect(memory.stored()).toEqual(stored);
          await openFilter(user);
          expect(rangeInput("scoreMin")).toHaveValue("");
          expect(rangeInput("scoreMax")).toHaveValue("");
          expect(screen.queryByRole("alert")).toBeNull();
        },
      );

      it("横長で検索して開いたままでも、閉じるボタンで閉じ、検索した条件は残り、検索後の未適用の変更だけを破棄する", async () => {
        // Given
        viewport.setLandscape(true);
        const user = await renderOpenedHistory();
        draftRange("scoreMin", "5");
        await user.click(filterAction("apply"));
        draftRange("scoreMin", "9");

        // When
        await user.click(closeButton());

        // Then
        expect(panel()).toBeNull();
        expect(toggle()).toHaveFocus();
        expect(memory.stored().input.scoreMin).toBe(5);
        expect(mark()).not.toBeNull();
        await openFilter(user);
        expect(rangeInput("scoreMin")).toHaveValue("5");
      });

      it("閉じるボタンを押しても、検索もリセットも起きない", async () => {
        // Given
        const user = await renderOpenedHistory();
        draftRange("scoreMin", "5");
        const requests = [...fake.store.loadList.mock.calls];

        // When
        await user.click(closeButton());

        // Then
        expect(memory.stored().input.scoreMin).toBeNull();
        expect(fake.store.loadList.mock.calls).toEqual(requests);
        await openFilter(user);
        expect(rangeInput("scoreMin")).toHaveValue("");
      });

      it.each([
        [
          "縦長の漏斗の再押下",
          false,
          async (user: ReturnType<typeof userEvent.setup>) =>
            user.click(toggle()),
        ],
        [
          "横長の漏斗の再押下",
          true,
          async (user: ReturnType<typeof userEvent.setup>) =>
            user.click(toggle()),
        ],
        [
          "縦長の閉じるボタン",
          false,
          async (user: ReturnType<typeof userEvent.setup>) =>
            user.click(closeButton()),
        ],
        [
          "横長の閉じるボタン",
          true,
          async (user: ReturnType<typeof userEvent.setup>) =>
            user.click(closeButton()),
        ],
        [
          "縦長のEsc",
          false,
          async () =>
            fireEvent.keyDown(rangeInput("scoreMin"), { key: "Escape" }),
        ],
        [
          "横長のEsc",
          true,
          async () =>
            fireEvent.keyDown(rangeInput("scoreMin"), { key: "Escape" }),
        ],
        [
          "縦長の検索",
          false,
          async (user: ReturnType<typeof userEvent.setup>) =>
            user.click(filterAction("apply")),
        ],
      ])(
        "%sで閉じると、開いている間だけ変わった漏斗の見た目が閉じた状態と同じに戻り、図柄と名前は変わらない",
        async (_route, landscape, close) => {
          // Given
          viewport.setLandscape(landscape);
          fetchResolves(varied);
          renderHistory();
          await screen.findByText("夜練習");
          const user = userEvent.setup();
          const closedLook = funnelLook();
          const closedSvg = toggle().querySelector("svg")?.outerHTML;
          const name = toggle().textContent;

          // When
          await openFilter(user);
          const openLook = funnelLook();
          await close(user);

          // Then
          expect(openLook).not.toBe(closedLook);
          expect(panel()).toBeNull();
          expect(funnelLook()).toBe(closedLook);
          expect(toggle().querySelector("svg")?.outerHTML).toBe(closedSvg);
          expect(toggle().textContent).toBe(name);
        },
      );

      it("横長で検索して開いたままのときは、展開中の漏斗の見た目が続く", async () => {
        // Given
        viewport.setLandscape(true);
        fetchResolves(varied);
        renderHistory();
        await screen.findByText("夜練習");
        const user = userEvent.setup();
        const closedLook = funnelLook();
        await openFilter(user);
        const openLook = funnelLook();
        draftRange("scoreMin", "5");

        // When
        await user.click(filterAction("apply"));

        // Then
        expect(toggle()).toHaveAttribute("aria-expanded", "true");
        expect(funnelLook()).toBe(openLook);
        expect(funnelLook()).not.toBe(closedLook);
      });

      it("適用済みの条件が既定でなければ、開くと展開中の見た目と適用中の印が同時にあり、閉じると印だけが残る", async () => {
        // Given
        remember({
          condition: { ...DEFAULT_HISTORY_CONDITION, format: "indoor" },
        });
        fetchResolves(varied);
        renderHistory();
        await screen.findByText("夜練習");
        const user = userEvent.setup();
        const closedLook = funnelLook();

        // When
        await openFilter(user);

        // Then
        expect(funnelLook()).not.toBe(closedLook);
        expect(mark()).toHaveTextContent(roundsText("historyFilterActive"));
        await user.click(toggle());
        expect(funnelLook()).toBe(closedLook);
        expect(mark()).toHaveTextContent(roundsText("historyFilterActive"));
      });

      it("適用済みの条件が既定なら、開いても印は出ない", async () => {
        // Given
        fetchResolves(varied);
        renderHistory();
        await screen.findByText("夜練習");
        const user = userEvent.setup();

        // When
        await openFilter(user);

        // Then
        expect(mark()).toBeNull();
      });
    });

    describe("中身と順序", () => {
      it("開いた中に、種別、弓種、ラウンド構成、期間、得点、距離単位で表示、リセット、適用が出る", async () => {
        // Given
        fetchResolves(varied);
        const user = userEvent.setup();
        renderHistory();
        await screen.findByText("夜練習");

        // When
        await openFilter(user);

        // Then
        const items = [
          screen.getByTestId(FORMAT_TEST_ID),
          screen.getByTestId(BOW_TYPE_TEST_ID),
          screen.getByTestId("history-filter-distance-add"),
          rangeInput("dateFrom"),
          rangeInput("scoreMin"),
          screen.getByTestId("history-unit-toggle"),
          filterAction("reset"),
          filterAction("apply"),
        ];
        for (const item of items) {
          expect(item).toBeVisible();
        }
      });

      it("初期値は、種別・弓種が指定なし、日付順が新しい順、得点順が指定なし、距離単位で表示がオフで、各欄が項目名を持つ", async () => {
        // Given
        fetchResolves(varied);
        const user = userEvent.setup();
        renderHistory();
        await screen.findByText("夜練習");

        // When
        await openFilter(user);

        // Then
        expect(selectedOf(FORMAT_TEST_ID)).toBe(
          roundsText("historyFilterNone"),
        );
        expect(selectedOf(BOW_TYPE_TEST_ID)).toBe(
          roundsText("historyFilterNone"),
        );
        expect(selectedOf(DATE_DIRECTION_TEST_ID)).toBe(
          roundsText("historyDateDirection.desc"),
        );
        expect(selectedOf(SCORE_DIRECTION_TEST_ID)).toBe(
          roundsText("historyFilterNone"),
        );
        expect(
          screen.getByRole("switch", {
            name: roundsText("historyShowDistances"),
          }),
        ).toHaveAttribute("aria-checked", "false");
        for (const name of [
          "roundConfigFormat",
          "roundConfigBowType",
          "historyFilterDateDirection",
          "historyFilterScoreDirection",
          "historyFilterDateFrom",
          "historyFilterDateTo",
          "historyFilterScoreMin",
          "historyFilterScoreMax",
        ] as const) {
          expect(screen.getByLabelText(roundsText(name))).toBeInTheDocument();
        }
      });

      it("種別と弓種の選択肢は、先頭の「指定なし」と全ての値で、日付順は新しい順・古い順だけ、得点順は先頭に「指定なし」を持つ", async () => {
        // Given
        fetchResolves(varied);
        const user = userEvent.setup();
        renderHistory();
        await screen.findByText("夜練習");
        await openFilter(user);

        // When
        const lists: (string | null)[][] = [];
        for (const testId of [
          FORMAT_TEST_ID,
          BOW_TYPE_TEST_ID,
          DATE_DIRECTION_TEST_ID,
          SCORE_DIRECTION_TEST_ID,
        ]) {
          await user.click(screen.getByTestId(testId));
          await screen.findAllByRole("option");
          lists.push(optionNames());
          await user.keyboard("{Escape}");
          await waitFor(() =>
            expect(screen.queryAllByRole("option")).toEqual([]),
          );
        }

        // Then
        const none = roundsText("historyFilterNone");
        expect(lists).toEqual([
          [none, ...FORMAT_OPTIONS.map((f) => roundsText(`formatOption.${f}`))],
          [
            none,
            ...BOW_TYPE_OPTIONS.map((b) => roundsText(`bowTypeOption.${b}`)),
          ],
          [
            roundsText("historyDateDirection.asc"),
            roundsText("historyDateDirection.desc"),
          ],
          [
            none,
            roundsText("historyScoreDirection.asc"),
            roundsText("historyScoreDirection.desc"),
          ],
        ]);
      });

      it("期間と得点の小見出しとくくり(group)は無く、入力欄は項目名で取れ、期間の行と得点の行に区切りの「~」(支援技術へ読ませない)が1つずつある", async () => {
        // Given
        fetchResolves(varied);
        const user = userEvent.setup();
        renderHistory();
        await screen.findByText("夜練習");

        // When
        await openFilter(user);

        // Then
        expect(
          within(screen.getByTestId("history-controls")).queryByRole("group"),
        ).toBeNull();
        const separators = within(
          screen.getByTestId("history-controls"),
        ).getAllByText("~");
        expect(separators).toHaveLength(2);
        for (const separator of separators) {
          expect(separator).toHaveAttribute("aria-hidden", "true");
        }
        expect(isBefore(rangeInput("dateFrom"), separators[0])).toBe(true);
        expect(isBefore(separators[0], rangeInput("dateTo"))).toBe(true);
        expect(isBefore(rangeInput("scoreMin"), separators[1])).toBe(true);
        expect(isBefore(separators[1], rangeInput("scoreMax"))).toBe(true);
      });

      it("開いた状態の画面に、旧い語(すべて、期間、得点の範囲、日付の向き、得点の向き、下限、上限、昇順、降順、一覧の単位、距離の構成、並べ替え・絞り込み、矢の総数、的を加える、的を外す、絞り込む距離)は出ない", async () => {
        // Given
        fetchResolves(varied);
        const user = userEvent.setup();
        renderHistory();
        await screen.findByText("夜練習");

        // When
        await openFilter(user);

        // Then
        const text = document.body.textContent ?? "";
        for (const word of [
          "すべて",
          "期間",
          "得点の範囲",
          "日付の向き",
          "得点の向き",
          "下限",
          "上限",
          "昇順",
          "降順",
          "一覧の単位",
          "距離の構成",
          "並べ替え・絞り込み",
          "矢の総数",
          "的を加える",
          "的を外す",
          "絞り込む距離",
        ]) {
          expect(text).not.toContain(word);
        }
        expect(screen.queryByTestId("history-unit-round")).toBeNull();
        expect(screen.queryByTestId("history-sort-key-score")).toBeNull();
      });
    });

    describe("適用", () => {
      it("種別と得点順を変えても、適用を押すまで取得もスケルトンも起きず、背後の一覧は変わらない", async () => {
        // Given
        const user = await renderOpenedHistory();
        const fetches = fake.store.loadList.mock.calls.length;

        // When
        await chooseFilter(
          user,
          FORMAT_TEST_ID,
          roundsText("formatOption.indoor"),
        );
        await chooseFilter(
          user,
          SCORE_DIRECTION_TEST_ID,
          roundsText("historyScoreDirection.desc"),
        );

        // Then
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
        expect(screen.queryByRole("status")).toBeNull();
        expect(shownNames()).toEqual(VARIED_NAMES);
      });

      it("適用すると、変更した値の条件で先頭から取得し直して表示済みをスケルトンに替え、パネルが閉じる", async () => {
        // Given
        const user = await renderOpenedHistory();
        nextFetchPends();
        await chooseFilter(
          user,
          FORMAT_TEST_ID,
          roundsText("formatOption.indoor"),
        );
        await chooseFilter(
          user,
          BOW_TYPE_TEST_ID,
          roundsText("bowTypeOption.compound"),
        );

        // When
        applyFilter();

        // Then
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          {
            ...DEFAULT_HISTORY_CONDITION,
            format: "indoor",
            bowType: "compound",
          },
          null,
          expect.any(Number),
        );
        expect(screen.getByRole("status")).toHaveTextContent(
          roundsText("fetchLoading"),
        );
        expect(screen.queryByRole("listitem")).toBeNull();
        await waitFor(() => expect(panel()).toBeNull());
        expect(memory.stored().input).toMatchObject({
          format: "indoor",
          bowType: "compound",
        });
      });

      it("指定なしを選んで適用すると、絞り込みなし(null)の条件で取得し直す", async () => {
        // Given
        remember({
          condition: {
            ...DEFAULT_HISTORY_CONDITION,
            format: "indoor",
            bowType: "compound",
          },
        });
        const user = await renderOpenedHistory();
        await chooseFilter(
          user,
          FORMAT_TEST_ID,
          roundsText("historyFilterNone"),
        );
        await chooseFilter(
          user,
          BOW_TYPE_TEST_ID,
          roundsText("historyFilterNone"),
        );

        // When
        applyFilter();

        // Then
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          DEFAULT_HISTORY_CONDITION,
          null,
          expect.any(Number),
        );
      });

      it("得点順を指定なしへ戻して適用すると日付順だけの条件を取得する", async () => {
        // Given
        const user = await renderOpenedHistory();
        await chooseFilter(
          user,
          DATE_DIRECTION_TEST_ID,
          roundsText("historyDateDirection.asc"),
        );
        await chooseFilter(
          user,
          SCORE_DIRECTION_TEST_ID,
          roundsText("historyScoreDirection.asc"),
        );
        const lastCondition = () =>
          fake.store.loadList.mock.calls.at(-1)?.[0] as HistoryCondition;

        applyFilter();

        const ascendingCondition = lastCondition();
        await waitFor(() => expect(panel()).toBeNull());
        await openFilter(user);
        await chooseFilter(
          user,
          DATE_DIRECTION_TEST_ID,
          roundsText("historyDateDirection.desc"),
        );
        await chooseFilter(
          user,
          SCORE_DIRECTION_TEST_ID,
          roundsText("historyScoreDirection.desc"),
        );
        applyFilter();
        const descendingCondition = lastCondition();
        await waitFor(() => expect(panel()).toBeNull());
        await openFilter(user);
        await chooseFilter(
          user,
          SCORE_DIRECTION_TEST_ID,
          roundsText("historyFilterNone"),
        );

        // When
        applyFilter();

        // Then
        expect(ascendingCondition).toMatchObject({
          dateDirection: "asc",
          scoreDirection: "asc",
        });
        expect(descendingCondition).toMatchObject({
          dateDirection: "desc",
          scoreDirection: "desc",
        });
        expect(lastCondition()).toMatchObject({
          dateDirection: "desc",
          scoreDirection: null,
        });
      });

      it("何も変えずに適用すると、取得し直さず、パネルが閉じる", async () => {
        // Given
        await renderOpenedHistory();
        const fetches = fake.store.loadList.mock.calls.length;

        // When
        applyFilter();

        // Then
        await waitFor(() => expect(panel()).toBeNull());
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
        expect(screen.queryByRole("status")).toBeNull();
      });

      it("条件を選んだ状態で削除すると、そのラウンドが表示から消える", async () => {
        // Given
        const user = await renderOpenedHistory();
        fetchResolves([varied[0], varied[3]]);
        await chooseFilter(
          user,
          FORMAT_TEST_ID,
          roundsText("formatOption.indoor"),
        );
        applyFilter();
        await screen.findByText("午後練習");
        await openDeleteDialog(user, "夜練習");

        // When
        await user.click(screen.getByTestId("confirm-dialog-confirm"));

        // Then
        await waitFor(() => {
          expect(shownNames()).toEqual(["午後練習"]);
        });
      });

      it("結果が0件になる条件を適用すると、該当するラウンドがないことだけを表示する", async () => {
        // Given
        const user = await renderOpenedHistory();
        fetchResolves([]);
        await chooseFilter(
          user,
          FORMAT_TEST_ID,
          roundsText("formatOption.field"),
        );

        // When
        applyFilter();

        // Then
        expect(
          await screen.findByText(roundsText("historyEmpty")),
        ).toBeInTheDocument();
        expect(screen.queryByText(roundsText("historyEnd"))).toBeNull();
        expect(screen.queryByRole("listitem")).toBeNull();
      });

      it("不正な入力(開始日が終了日より後、最低点が最高点より大きい、ラウンド構成に行がある)で適用すると、範囲の欄の下にだけエラーが同時に出て、距離のエラーは出ず、取得せず、パネルは開いたままである", async () => {
        // Given
        const user = await renderOpenedHistory();
        await addDistance(user, "50");
        const fetches = fake.store.loadList.mock.calls.length;
        draftRange("dateFrom", "2026-06-01");
        draftRange("dateTo", "2026-05-01");
        draftRange("scoreMin", "9");
        draftRange("scoreMax", "1");
        const before = memory.stored();

        // When
        applyFilter();

        // Then
        expect(
          screen.getByTestId("history-filter-error-dateOrder"),
        ).toBeVisible();
        expect(
          screen.getByTestId("history-filter-error-scoreOrder"),
        ).toBeVisible();
        expect(screen.getAllByRole("alert")).toHaveLength(2);
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
        expect(memory.stored()).toEqual(before);
        expect(panel()).not.toBeNull();
        expect(rangeInput("dateFrom")).toHaveValue("2026-06-01");
      });

      it("エラーは適用の前には出ず、直しても次の適用まで残り、正しくして適用するとエラーが消えて確定する", async () => {
        // Given
        const user = await renderOpenedHistory();
        await user.type(rangeInput("scoreMin"), "9");
        await user.type(rangeInput("scoreMax"), "1");
        const beforeApply = screen.queryByRole("alert");
        applyFilter();
        const shown = screen.getByTestId(
          "history-filter-error-scoreOrder",
        ).isConnected;

        // When
        await user.clear(rangeInput("scoreMax"));
        await user.type(rangeInput("scoreMax"), "20");
        const afterFix = screen.queryByTestId(
          "history-filter-error-scoreOrder",
        );
        applyFilter();

        // Then
        expect(beforeApply).toBeNull();
        expect(shown).toBe(true);
        expect(afterFix).not.toBeNull();
        await waitFor(() => expect(panel()).toBeNull());
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          { ...DEFAULT_HISTORY_CONDITION, scoreMin: 9, scoreMax: 20 },
          null,
          expect.any(Number),
        );
      });

      it("範囲の編集中の値は、種別の変更などの別の操作の間も失われず、適用まで反映されない", async () => {
        // Given
        const user = await renderOpenedHistory();
        draftRange("scoreMin", "300");

        // When
        await chooseFilter(
          user,
          SCORE_DIRECTION_TEST_ID,
          roundsText("historyScoreDirection.desc"),
        );

        // Then
        expect(rangeInput("scoreMin")).toHaveValue("300");
        expect(memory.stored().input.scoreMin).toBeNull();
      });
    });

    describe("閉じる・リセット", () => {
      it("変更してEscで閉じると、入力値も一覧も変わらず、開き直すと保存した入力値が出て、変更は残らない", async () => {
        // Given
        const user = await renderOpenedHistory();
        const fetches = fake.store.loadList.mock.calls.length;
        await chooseFilter(
          user,
          FORMAT_TEST_ID,
          roundsText("formatOption.indoor"),
        );
        draftRange("scoreMin", "300");

        // When
        await user.keyboard("{Escape}");
        await waitFor(() => expect(panel()).toBeNull());
        await openFilter(user);

        // Then
        expect(memory.stored()).toEqual(DEFAULT_HISTORY_VIEW_STATE);
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
        expect(selectedOf(FORMAT_TEST_ID)).toBe(
          roundsText("historyFilterNone"),
        );
        expect(rangeInput("scoreMin")).toHaveValue("");
      });

      it("エラーを出した状態で閉じて開き直すと、エラーは残らない", async () => {
        // Given
        const user = await renderOpenedHistory();
        draftRange("scoreMin", "9");
        draftRange("scoreMax", "1");
        applyFilter();
        const shown = screen.queryByTestId("history-filter-error-scoreOrder");

        // When
        await user.keyboard("{Escape}");
        await waitFor(() => expect(panel()).toBeNull());
        await openFilter(user);

        // Then
        expect(shown).not.toBeNull();
        expect(screen.queryByRole("alert")).toBeNull();
        expect(rangeInput("scoreMin")).toHaveValue("");
      });

      it("リセットすると、編集中の値(エラー、ラウンド構成と選んだ距離を含む)が既定に戻り、要約が消えて「距離を追加」だけになり、パネルは閉じず、入力値も取得も変わらない", async () => {
        // Given
        remember({
          condition: {
            ...DEFAULT_HISTORY_CONDITION,
            format: "indoor",
            scoreMin: 100,
            distances: [distanceRow(50)],
          },
        });
        const user = await renderOpenedHistory();
        const fetches = fake.store.loadList.mock.calls.length;
        const before = memory.stored();
        await user.click(screen.getByTestId("history-unit-toggle"));
        await selectDistance(user, "30");
        draftRange("scoreMax", "1");
        applyFilter();

        // When
        await user.click(filterAction("reset"));

        // Then
        expect(panel()).not.toBeNull();
        expect(selectedOf(FORMAT_TEST_ID)).toBe(
          roundsText("historyFilterNone"),
        );
        for (const field of ["dateFrom", "dateTo", "scoreMin", "scoreMax"]) {
          expect(rangeInput(field)).toHaveValue("");
        }
        expect(screen.queryByTestId("history-filter-distance-0")).toBeNull();
        expect(screen.getByTestId("history-filter-distance-add")).toBeVisible();
        expect(
          screen.queryByTestId("history-filter-distance-select"),
        ).toBeNull();
        expect(screen.queryByTestId("history-filter-distance-row")).toBeNull();
        expect(screen.getByTestId("history-unit-toggle")).toHaveAttribute(
          "aria-checked",
          "false",
        );
        expect(screen.queryByRole("alert")).toBeNull();
        expect(memory.stored()).toEqual(before);
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
      });

      it("リセットの後に適用すると、既定が入力値になり、既定の条件で取得し直す", async () => {
        // Given
        remember({
          condition: { ...DEFAULT_HISTORY_CONDITION, format: "indoor" },
        });
        const user = await renderOpenedHistory();
        await user.click(filterAction("reset"));

        // When
        applyFilter();

        // Then
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          DEFAULT_HISTORY_CONDITION,
          null,
          expect.any(Number),
        );
        expect(memory.stored()).toEqual(DEFAULT_HISTORY_VIEW_STATE);
        await waitFor(() => expect(panel()).toBeNull());
        expect(mark()).toBeNull();
      });
    });

    describe("距離単位で表示と絞り込む距離", () => {
      const unitToggle = () => screen.getByTestId("history-unit-toggle");
      const selectButton = () =>
        screen.queryByTestId("history-filter-distance-select");
      const summary = () => screen.queryByTestId("history-filter-distance-row");

      it("「距離単位で表示」のスイッチは、見出しを名前に持ち、状態をaria-checkedで伝え、「一覧の単位」のボタン群は無い", async () => {
        // Given

        // When
        await renderOpenedHistory();

        // Then
        expect(
          screen.getByRole("switch", {
            name: roundsText("historyShowDistances"),
          }),
        ).toBe(unitToggle());
        expect(unitToggle()).toHaveAttribute("aria-checked", "false");
        expect(screen.queryByTestId("history-unit-distance")).toBeNull();
      });

      it("距離単位をオフへ戻すと距離の選択を隠し適用前の取得を起こさない", async () => {
        // Given
        const user = await renderOpenedHistory();
        const fetches = fake.store.loadList.mock.calls.length;
        const off = selectButton();

        await user.click(unitToggle());
        const checkedOn = unitToggle().getAttribute("aria-checked");
        const selectLabelOn = selectButton()?.textContent;
        const fetchesOn = fake.store.loadList.mock.calls.length;

        // When
        await user.click(unitToggle());

        // Then
        expect(off).toBeNull();
        expect(checkedOn).toBe("true");
        expect(selectLabelOn).toBe(roundsText("historyFilterDistanceSelect"));
        expect(fetchesOn).toBe(fetches);
        expect(selectButton()).toBeNull();
      });

      it("距離単位からラウンド単位に戻して適用するとラウンド条件を取得する", async () => {
        // Given
        const user = await renderOpenedHistory();
        await user.click(unitToggle());

        applyFilter();

        const distanceCondition = fake.store.loadList.mock.calls.at(-1)?.[0];
        await waitFor(() => expect(panel()).toBeNull());
        await openFilter(user);
        const checkedAfterReopen = unitToggle().getAttribute("aria-checked");
        await user.click(unitToggle());

        // When
        applyFilter();

        // Then
        expect(distanceCondition).toEqual({
          ...DEFAULT_HISTORY_CONDITION,
          unit: "distance",
        });
        expect(checkedAfterReopen).toBe("true");
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          DEFAULT_HISTORY_CONDITION,
          null,
          expect.any(Number),
        );
      });

      it("オフにすると、選んだ距離の要約は隠れるが距離の行は編集中の値に保たれ、オンに戻すと要約が復元される", async () => {
        // Given
        const user = await renderOpenedHistory();
        await user.click(unitToggle());
        await selectDistance(user, "50");

        // When
        await user.click(unitToggle());
        const hidden = summary();
        await user.click(unitToggle());

        // Then
        expect(hidden).toBeNull();
        expect(summary()).toHaveTextContent("50m");
      });

      it("ラウンド単位で保持した距離は開き直して距離単位へ戻すと要約に復元する", async () => {
        // Given
        const user = await renderOpenedHistory();
        const fetches = fake.store.loadList.mock.calls.length;
        await user.click(unitToggle());
        await selectDistance(user, "50");
        await user.click(unitToggle());

        applyFilter();

        await waitFor(() => expect(panel()).toBeNull());
        const fetchesAfterApply = fake.store.loadList.mock.calls.length;
        const markAfterApply = mark();
        const storedRow = memory.stored().input.distanceRow;
        await openFilter(user);

        // When
        await user.click(unitToggle());

        // Then
        expect(fetchesAfterApply).toBe(fetches);
        expect(markAfterApply).toBeNull();
        expect(storedRow).toEqual(distanceRow(50));
        expect(summary()).toHaveTextContent("50m");
      });

      it("保持した距離で距離単位を再適用すると取得条件へ戻る", async () => {
        // Given
        remember({
          condition: {
            ...DEFAULT_HISTORY_CONDITION,
            unit: "distance",
            distanceRow: distanceRow(50),
          },
        });
        fetchResolves(distances);
        renderHistory();
        await screen.findAllByText("午前練習");
        const user = userEvent.setup();
        await openFilter(user);
        await user.click(unitToggle());

        applyFilter();

        const roundCondition = fake.store.loadList.mock.calls.at(-1)?.[0];
        const storedRow = memory.stored().input.distanceRow;
        await waitFor(() => expect(panel()).toBeNull());
        await openFilter(user);
        await user.click(unitToggle());
        const restoredSummary = summary()?.textContent;

        // When
        applyFilter();

        // Then
        expect(roundCondition).toEqual({
          ...DEFAULT_HISTORY_CONDITION,
          unit: "round",
          distanceRow: null,
        });
        expect(storedRow).toEqual(distanceRow(50));
        expect(restoredSummary).toContain("50m");
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          {
            ...DEFAULT_HISTORY_CONDITION,
            unit: "distance",
            distanceRow: distanceRow(50),
          },
          null,
          expect.any(Number),
        );
      });
    });

    describe("保持", () => {
      it("保存された入力値が各欄に復元され、パネルは閉じていて、取得の条件は入力値から導出したものである", async () => {
        // Given
        remember({
          condition: {
            ...DEFAULT_HISTORY_CONDITION,
            dateDirection: "asc",
            scoreDirection: "desc",
            format: "outdoor",
            bowType: "barebow",
            scoreMin: 100,
          },
        });
        fetchResolves(varied);
        const user = userEvent.setup();

        // When
        renderHistory();
        await screen.findByText("朝練習");
        const closed = panel();
        await openFilter(user);

        // Then
        expect(closed).toBeNull();
        expect(fake.store.loadList).toHaveBeenCalledExactlyOnceWith(
          {
            ...DEFAULT_HISTORY_CONDITION,
            dateDirection: "asc",
            scoreDirection: "desc",
            format: "outdoor",
            bowType: "barebow",
            scoreMin: 100,
          },
          null,
          expect.any(Number),
        );
        expect(selectedOf(DATE_DIRECTION_TEST_ID)).toBe(
          roundsText("historyDateDirection.asc"),
        );
        expect(selectedOf(SCORE_DIRECTION_TEST_ID)).toBe(
          roundsText("historyScoreDirection.desc"),
        );
        expect(selectedOf(FORMAT_TEST_ID)).toBe(
          roundsText("formatOption.outdoor"),
        );
        expect(selectedOf(BOW_TYPE_TEST_ID)).toBe(
          roundsText("bowTypeOption.barebow"),
        );
        expect(rangeInput("scoreMin")).toHaveValue("100");
      });

      it("旧い形の保存値(sortKey=score、unit=distance、filterOpen)は、読み替えられず、既定の入力値で復元され、距離単位で表示はオフである", async () => {
        // Given
        // 旧い形を読み替えない規則はdomainで確かめる。ここでは、画面までの接続だけを確かめる。
        memory = createFakeHistoryViewMemory({
          input: historyViewStateOf({
            condition: {
              unit: "distance",
              sortKey: "score",
              sortDirection: "asc",
            },
            filterOpen: false,
          }).input,
        });
        procedures.historyViewMemory = memory.memory;
        fetchResolves(varied);
        const user = userEvent.setup();

        // When
        renderHistory();
        await screen.findByText("夜練習");
        await openFilter(user);

        // Then
        expect(fake.store.loadList).toHaveBeenCalledExactlyOnceWith(
          DEFAULT_HISTORY_CONDITION,
          null,
          expect.any(Number),
        );
        expect(screen.getByTestId("history-unit-toggle")).toHaveAttribute(
          "aria-checked",
          "false",
        );
        expect(selectedOf(SCORE_DIRECTION_TEST_ID)).toBe(
          roundsText("historyFilterNone"),
        );
      });

      it("編集中の値とエラーは保持されず、画面を離れて戻ると、パネルは閉じていて保存した入力値が出る", async () => {
        // Given
        const user = await renderOpenedHistory();
        await chooseFilter(
          user,
          FORMAT_TEST_ID,
          roundsText("formatOption.indoor"),
        );
        draftRange("scoreMin", "9");
        draftRange("scoreMax", "1");
        applyFilter();
        cleanup();

        // When
        renderHistory();
        await screen.findByText("夜練習");
        const closed = panel();
        await openFilter(user);

        // Then
        expect(closed).toBeNull();
        expect(screen.queryByRole("alert")).toBeNull();
        expect(selectedOf(FORMAT_TEST_ID)).toBe(
          roundsText("historyFilterNone"),
        );
        expect(rangeInput("scoreMin")).toHaveValue("");
      });
    });
  });

  describe("期間と得点の範囲", () => {
    async function renderOpened() {
      const user = await renderOpenedHistory();
      return user;
    }

    // 2つの要素を共に含む最も内側の祖先。
    function rowOf(first: HTMLElement, second: HTMLElement) {
      let row = first.parentElement;
      while (row && !row.contains(second)) row = row.parentElement;
      if (!row) throw new Error("common ancestor not found");
      return row;
    }

    it.each([
      ["期間", ["dateFrom", "dateTo"], DATE_DIRECTION_TEST_ID],
      ["得点", ["scoreMin", "scoreMax"], SCORE_DIRECTION_TEST_ID],
    ] as const)(
      "%sの行に、範囲の入力と向きの選択が並ぶ",
      async (_name, fields, directionTestId) => {
        // Given
        await renderOpened();

        // When
        const row = within(
          rowOf(rangeInput(fields[0]), screen.getByTestId(directionTestId)),
        );

        // Then
        expect(
          row.getByTestId(`history-filter-${fields[1]}`),
        ).toBeInTheDocument();
        expect(row.getByTestId(directionTestId)).toBeInTheDocument();
      },
    );

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
        applyFilter();

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

    it("入力の途中は検証も取得もせず、欄を離れたときに最後の値で1回だけ取得する", async () => {
      // Given
      const user = await renderOpened();
      const fetches = fake.store.loadList.mock.calls.length;

      // When
      await user.type(rangeInput("scoreMin"), "500");
      const duringTyping = fake.store.loadList.mock.calls.length;
      applyFilter();

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
      });
      const user = await renderOpenedHistory();

      // When
      await user.clear(rangeInput("scoreMin"));
      applyFilter();

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
      });
      const user = await renderOpenedHistory();
      const fetches = fake.store.loadList.mock.calls.length;

      // When
      await user.clear(rangeInput("scoreMin"));
      await user.type(rangeInput("scoreMin"), "300");
      applyFilter();

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

    it("4つの下書きをまとめて検証し、組が正しくなった適用で、両方を反映して1回取得する", async () => {
      // Given
      const user = await renderOpened();
      await user.type(rangeInput("dateTo"), "2026-05-01");
      await user.type(rangeInput("dateFrom"), "2026-05-02");
      applyFilter();
      const fetches = fake.store.loadList.mock.calls.length;

      // When
      await user.clear(rangeInput("dateTo"));
      await user.type(rangeInput("dateTo"), "2026-05-31");
      applyFilter();

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

    it("閉じている間は、選んだ範囲もエラーも示さず、範囲の条件は適用され続ける", async () => {
      // Given
      remember({
        condition: { ...DEFAULT_HISTORY_CONDITION, scoreMin: 300 },
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
      });
      fetchResolves(varied);

      // When
      renderHistory();
      await screen.findByText("夜練習");
      await openFilter(userEvent.setup());

      // Then
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
      applyFilter();

      // Then
      expect(memory.stored()).toEqual({
        input: {
          ...DEFAULT_HISTORY_CONDITION,
          dateFrom: "2026-05-01",
          scoreMax: 600,
        },
      });
    });

    it("範囲に一致するラウンドがなければ、該当するラウンドがないことだけを表示する", async () => {
      // Given
      const user = await renderOpened();
      fetchResolves([]);

      // When
      await user.type(rangeInput("scoreMin"), "9999");
      applyFilter();

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
      overrides: Partial<HistoryCondition> = {},
    ) {
      remember({
        condition: { ...DEFAULT_HISTORY_CONDITION, ...overrides, distances },
      });
      return renderOpenedHistory();
    }

    function conditionWith(distances: HistoryDistanceRow[]) {
      return { ...DEFAULT_HISTORY_CONDITION, distances };
    }

    // ラウンド構成の要約(追加済みの距離)を、並びのまま返す。
    const summaries = () =>
      screen.queryAllByTestId(/^history-filter-distance-\d+$/);
    const summaryTexts = () => summaries().map((item) => item.textContent);
    const addButton = () => screen.getByTestId("history-filter-distance-add");
    const confirmButton = () =>
      screen.getByTestId("history-distance-dialog-confirm");
    const dialogError = (error: HistoryDistanceError) =>
      screen.queryByTestId(`history-distance-dialog-error-${error}`);

    describe("追加と要約", () => {
      it("最初は要約がなく「距離を追加」だけがあり、押すと、欄が空で的が「指定なし」のダイアログが「追加」の確定で開き、取得は起きない", async () => {
        // Given
        const user = await renderWithDistances();
        const fetches = fake.store.loadList.mock.calls.length;

        // When
        const before = summaries();
        await user.click(addButton());

        // Then
        expect(before).toEqual([]);
        expect(addButton()).toHaveTextContent(roundsText("addDistance"));
        expect(dialogInput("distance")).toHaveValue("");
        expect(dialogInput("arrowsPerEnd")).toHaveValue("");
        expect(
          screen.getByTestId("history-distance-dialog-target"),
        ).toHaveTextContent(roundsText("historyFilterNone"));
        expect(confirmButton()).toHaveTextContent(
          roundsText("historyDistanceAdd"),
        );
        expect(
          screen.queryByTestId("history-distance-dialog-delete"),
        ).toBeNull();
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
      });

      it("距離だけを入れて「追加」を押すと、ダイアログが閉じ、矢数の行のない距離の要約が出て、適用前は取得も記憶の変更も起きない", async () => {
        // Given
        const user = await renderWithDistances();
        const fetches = fake.store.loadList.mock.calls.length;

        // When
        await addDistance(user, "50");

        // Then
        expect(summaries()).toHaveLength(1);
        expect(summaries()[0]).toHaveTextContent("50m");
        expect(summaries()[0]).not.toHaveTextContent(
          roundsText("distanceArrowsPerEnd", { arrowsPerEnd: "6" }),
        );
        expect(summaries()[0]).toHaveTextContent(
          roundsText("historyFilterNone"),
        );
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
        expect(memory.stored()).toEqual(DEFAULT_HISTORY_VIEW_STATE);
      });

      it("1エンドの矢数を指定して確定すると、要約に距離と「N本」が出る", async () => {
        // Given
        const user = await renderWithDistances();

        // When
        await addDistance(user, "50", "6");

        // Then
        expect(summaries()[0]).toHaveTextContent("50m");
        expect(summaries()[0]).toHaveTextContent(
          roundsText("distanceArrowsPerEnd", { arrowsPerEnd: "6" }),
        );
      });

      it("的を選択済みの距離を確定すると要約に的を表示する", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue(FACES);
        const user = await renderWithDistances();
        await user.click(addButton());
        await user.type(dialogInput("distance"), "50");

        await user.click(screen.getByTestId("history-distance-dialog-target"));
        await user.click(
          await screen.findByTestId(`target-face-option-${OUTDOOR_FACE.id}`),
        );
        const dialogStillOpen = confirmButton().isConnected;
        const typedDistance = (dialogInput("distance") as HTMLInputElement)
          .value;
        const targetLabel = screen.getByTestId(
          "history-distance-dialog-target",
        ).textContent;

        // When
        await user.click(confirmButton());

        // Then
        expect(dialogStillOpen).toBe(true);
        expect(typedDistance).toBe("50");
        expect(targetLabel).not.toBe(roundsText("historyFilterNone"));
        await waitForDistanceDialogClosed();
        expect(summaries()[0]).not.toHaveTextContent(
          roundsText("historyFilterNone"),
        );
      });

      it("的の領域は、ラベル「的」で取得できる", async () => {
        // Given
        const user = await renderWithDistances();

        // When
        await user.click(addButton());

        // Then
        expect(screen.getByLabelText(roundsText("historyFilterTarget"))).toBe(
          screen.getByTestId("history-distance-dialog-target"),
        );
      });

      it("距離の行を足して適用すると、その行だけのラウンド構成で先頭から取得し直し、表示中のラウンドはスケルトンに置き換わる", async () => {
        // Given
        const user = await renderWithDistances();
        await addDistance(user, "50");
        nextFetchPends();

        // When
        applyFilter();

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
      });

      it("1エンドの矢数を入れた確定は矢数の値で、空の確定はnullで、取得の条件の行になる", async () => {
        // Given
        const user = await renderWithDistances();
        await addDistance(user, "50", "6");
        await addDistance(user, "30");

        // When
        applyFilter();

        // Then
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([
            distanceRow(50, { arrowsPerEnd: 6 }),
            distanceRow(30),
          ]),
          null,
          expect.any(Number),
        );
      });

      it("同じ距離を複数回追加でき、追加の順(射つ順)のまま1回で取得する", async () => {
        // Given
        const user = await renderWithDistances();
        await addDistance(user, "50");
        await addDistance(user, "30");
        await addDistance(user, "50");
        const fetches = fake.store.loadList.mock.calls.length;
        const shown = summaryTexts();

        // When
        applyFilter();

        // Then
        expect(shown).toHaveLength(3);
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches + 1);
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([distanceRow(50), distanceRow(30), distanceRow(50)]),
          null,
          expect.any(Number),
        );
      });

      it("反映済みの行を削除して同じ値で追加し直して適用しても、取得し直さず、スケルトンにならない", async () => {
        // Given
        const user = await renderWithDistances([distanceRow(50)]);
        const fetches = fake.store.loadList.mock.calls.length;
        await user.click(screen.getByTestId("history-filter-distance-0"));
        await user.click(screen.getByTestId("history-distance-dialog-delete"));
        await waitForDistanceDialogClosed();
        await addDistance(user, "50");

        // When
        applyFilter();

        // Then
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
        expect(screen.queryByRole("status")).toBeNull();
        expect(shownNames()).toEqual(VARIED_NAMES);
      });

      it("距離の構成に一致するラウンドがなければ、該当するラウンドがないことだけを表示する", async () => {
        // Given
        const user = await renderWithDistances();
        await addDistance(user, "99");
        fetchResolves([]);

        // When
        applyFilter();

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
        await addDistance(user, "50");

        // When
        applyFilter();

        // Then
        await waitFor(() => expect(shownNames()).toEqual(VARIED_NAMES));
      });
    });

    describe("ダイアログの検証と破棄", () => {
      it.each([
        ["距離が空", "", "", "distanceInvalid"],
        ["距離が範囲外(101)", "101", "", "distanceInvalid"],
        ["1エンドの矢数が範囲外(13)", "50", "13", "arrowsPerEndInvalid"],
      ] as const)(
        "%sで「追加」を押すと、閉じず、その欄の下に原因の文言を出し、要約も取得も増えない",
        async (_name, distance, arrowsPerEnd, error) => {
          // Given
          const user = await renderWithDistances();
          const fetches = fake.store.loadList.mock.calls.length;
          await user.click(addButton());
          if (distance !== "") {
            await user.type(dialogInput("distance"), distance);
          }
          if (arrowsPerEnd !== "") {
            await user.type(dialogInput("arrowsPerEnd"), arrowsPerEnd);
          }

          // When
          await user.click(confirmButton());

          // Then
          expect(dialogError(error)).toHaveTextContent(
            roundsText(`historyDistanceError.${error}`),
          );
          expect(confirmButton()).toBeInTheDocument();
          expect(summaries()).toEqual([]);
          expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
        },
      );

      it("エラーの後に入力を直しても、確定を押すまでエラーは残り、押すとエラーが消えて確定する", async () => {
        // Given
        const user = await renderWithDistances();
        await user.click(addButton());
        await user.type(dialogInput("distance"), "0");
        await user.click(confirmButton());

        // When
        await user.clear(dialogInput("distance"));
        await user.type(dialogInput("distance"), "50");
        const remains = dialogError("distanceInvalid");
        await user.click(confirmButton());
        await waitForDistanceDialogClosed();

        // Then
        expect(remains).not.toBeNull();
        expect(screen.queryByRole("alert")).toBeNull();
        expect(summaries()).toHaveLength(1);
      });

      it("入力して閉じると、要約は増えず、開き直すと空の欄から始まり、エラーも残らない", async () => {
        // Given
        const user = await renderWithDistances();
        await user.click(addButton());
        await user.type(dialogInput("distance"), "0");
        await user.click(confirmButton());

        // When
        await user.keyboard("{Escape}");
        await waitForDistanceDialogClosed();
        await user.click(addButton());

        // Then
        expect(summaries()).toEqual([]);
        expect(dialogInput("distance")).toHaveValue("");
        expect(screen.queryByRole("alert")).toBeNull();
      });
    });

    describe("編集と削除", () => {
      it("既存の距離を変更して適用すると置き換えた構成で取得する", async () => {
        // Given
        const user = await renderWithDistances([
          distanceRow(50, { arrowsPerEnd: 6 }),
          distanceRow(30),
        ]);

        await user.click(screen.getByTestId("history-filter-distance-0"));
        const opened = {
          distance: (dialogInput("distance") as HTMLInputElement).value,
          arrowsPerEnd: (dialogInput("arrowsPerEnd") as HTMLInputElement).value,
          confirm: confirmButton().textContent,
          hasDelete: screen.queryByTestId("history-distance-dialog-delete"),
        };
        await user.clear(dialogInput("distance"));
        await user.type(dialogInput("distance"), "70");
        await user.click(confirmButton());
        await waitForDistanceDialogClosed();
        const editedSummaries = summaries().map((row) => row.textContent);

        // When
        applyFilter();

        // Then
        expect(opened.distance).toBe("50");
        expect(opened.arrowsPerEnd).toBe("6");
        expect(opened.confirm).toBe(roundsText("confirm"));
        expect(opened.hasDelete).not.toBeNull();
        expect(editedSummaries[0]).toContain("70m");
        expect(editedSummaries[1]).toContain("30m");
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([
            distanceRow(70, { arrowsPerEnd: 6 }),
            distanceRow(30),
          ]),
          null,
          expect.any(Number),
        );
      });

      it("編集で不正な値を保存しようとすると、閉じず、原因の文言を出し、行は元のままである", async () => {
        // Given
        const user = await renderWithDistances([distanceRow(50)]);
        await user.click(screen.getByTestId("history-filter-distance-0"));

        // When
        await user.clear(dialogInput("distance"));
        await user.click(confirmButton());

        // Then
        expect(dialogError("distanceInvalid")).not.toBeNull();
        expect(confirmButton()).toBeInTheDocument();
        expect(summaries()[0]).toHaveTextContent("50m");
      });

      it("未確定で閉じた距離を開き直すと元の値を表示する", async () => {
        // Given
        const user = await renderWithDistances([distanceRow(50)]);
        await user.click(screen.getByTestId("history-filter-distance-0"));
        await user.clear(dialogInput("distance"));
        await user.type(dialogInput("distance"), "70");

        await user.keyboard("{Escape}");
        await waitForDistanceDialogClosed();
        const summaryAfterDiscard = summaries()[0]?.textContent;

        // When
        await user.click(screen.getByTestId("history-filter-distance-0"));

        // Then
        expect(summaryAfterDiscard).toContain("50m");
        expect(dialogInput("distance")).toHaveValue("50");
      });

      it("距離を削除して適用すると残る構成で取得する", async () => {
        // Given
        const user = await renderWithDistances([
          distanceRow(50),
          distanceRow(30),
          distanceRow(70),
        ]);
        const fetches = fake.store.loadList.mock.calls.length;

        await user.click(screen.getByTestId("history-filter-distance-1"));
        await user.click(screen.getByTestId("history-distance-dialog-delete"));
        await waitForDistanceDialogClosed();

        const remainingSummaries = summaries().map((row) => row.textContent);
        const fetchesAfterDelete = fake.store.loadList.mock.calls.length;

        // When
        applyFilter();

        // Then
        expect(remainingSummaries).toHaveLength(2);
        expect(remainingSummaries[0]).toContain("50m");
        expect(remainingSummaries[1]).toContain("70m");
        expect(fetchesAfterDelete).toBe(fetches);
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([distanceRow(50), distanceRow(70)]),
          null,
          expect.any(Number),
        );
      });

      it("最後の1件を削除すると、要約が無くなり、距離の構成を空の配列(指定なし)にして取得し直す", async () => {
        // Given
        const user = await renderWithDistances([distanceRow(50)]);
        await user.click(screen.getByTestId("history-filter-distance-0"));
        await user.click(screen.getByTestId("history-distance-dialog-delete"));
        await waitForDistanceDialogClosed();

        // When
        applyFilter();

        // Then
        expect(summaries()).toEqual([]);
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          DEFAULT_HISTORY_CONDITION,
          null,
          expect.any(Number),
        );
      });

      it("追加、真ん中の編集、先頭の削除、追加の後も、行の並びは操作の結果の順である", async () => {
        // Given
        const user = await renderWithDistances();
        await addDistance(user, "50");
        await addDistance(user, "30");
        await addDistance(user, "70");

        // When
        await user.click(screen.getByTestId("history-filter-distance-1"));
        await user.clear(dialogInput("distance"));
        await user.type(dialogInput("distance"), "40");
        await user.click(confirmButton());
        await waitForDistanceDialogClosed();
        await user.click(screen.getByTestId("history-filter-distance-0"));
        await user.click(screen.getByTestId("history-distance-dialog-delete"));
        await waitForDistanceDialogClosed();
        await addDistance(user, "20");
        applyFilter();

        // Then
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([distanceRow(40), distanceRow(70), distanceRow(20)]),
          null,
          expect.any(Number),
        );
      });
    });

    describe("的", () => {
      it("的の領域を押すと、保存した的が先頭の「指定なし」の後に全て並び、種別と弓種の絞り込みは指定なしで開く", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue(FACES);
        const user = await renderWithDistances();
        await user.click(addButton());
        await user.type(dialogInput("distance"), "50");

        // When
        await user.click(screen.getByTestId("history-distance-dialog-target"));

        // Then
        for (const face of FACES) {
          expect(
            await screen.findByTestId(`target-face-option-${face.id}`),
          ).toBeVisible();
        }
        expect(
          screen
            .getByTestId("history-distance-dialog-target-none")
            .compareDocumentPosition(
              screen.getByTestId(`target-face-option-${OUTDOOR_FACE.id}`),
            ) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(
          screen.getByTestId("target-face-format-select"),
        ).toHaveTextContent(roundsText("targetFaceFilterNone"));
        expect(
          screen.getByTestId("target-face-bow-type-select"),
        ).toHaveTextContent(roundsText("targetFaceFilterNone"));
      });

      it("的を選んだ距離を確定して適用すると的を含む条件で取得する", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue(FACES);
        const user = await renderWithDistances();
        await user.click(addButton());
        await user.type(dialogInput("distance"), "50");

        await user.click(screen.getByTestId("history-distance-dialog-target"));
        await user.click(
          await screen.findByTestId(`target-face-option-${OUTDOOR_FACE.id}`),
        );
        await user.click(confirmButton());
        await waitForDistanceDialogClosed();

        // When
        applyFilter();

        // Then
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([distanceRow(50, { targetFaceId: OUTDOOR_FACE.id })]),
          null,
          expect.any(Number),
        );
      });

      it("的を指定なしへ変更して適用すると的を含まない条件で取得する", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue(FACES);
        const user = await renderWithDistances([
          distanceRow(50, { targetFaceId: OUTDOOR_FACE.id }),
        ]);
        await user.click(screen.getByTestId("history-filter-distance-0"));
        const before = screen.getByTestId(
          "history-distance-dialog-target",
        ).textContent;

        await user.click(screen.getByTestId("history-distance-dialog-target"));
        await user.click(
          await screen.findByTestId("history-distance-dialog-target-none"),
        );
        await user.click(confirmButton());
        await waitForDistanceDialogClosed();

        // When
        applyFilter();

        // Then
        expect(before).not.toBe(roundsText("historyFilterNone"));
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([distanceRow(50)]),
          null,
          expect.any(Number),
        );
      });

      it("別の的へ選び直して適用すると新しい的の条件で取得する", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue(FACES);
        const user = await renderWithDistances([
          distanceRow(50, { targetFaceId: OUTDOOR_FACE.id }),
        ]);
        await user.click(screen.getByTestId("history-filter-distance-0"));

        await user.click(screen.getByTestId("history-distance-dialog-target"));
        await user.click(
          await screen.findByTestId(`target-face-option-${INDOOR_FACE.id}`),
        );
        await user.click(confirmButton());
        await waitForDistanceDialogClosed();

        // When
        applyFilter();

        // Then
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([distanceRow(50, { targetFaceId: INDOOR_FACE.id })]),
          null,
          expect.any(Number),
        );
      });

      it.each([
        ["未指定", null, "true"],
        ["指定済み", OUTDOOR_FACE.id, "false"],
      ])(
        "的が%sのとき、一覧の「指定なし」が選択中かどうかを押下の状態で示す",
        async (_name, targetFaceId, pressed) => {
          // Given
          procedures.fetching.savedTargetFaces.mockReturnValue(FACES);
          const user = await renderWithDistances([
            distanceRow(50, { targetFaceId }),
          ]);
          await user.click(screen.getByTestId("history-filter-distance-0"));

          // When
          await user.click(
            screen.getByTestId("history-distance-dialog-target"),
          );

          // Then
          expect(
            await screen.findByTestId("history-distance-dialog-target-none"),
          ).toHaveAttribute("aria-pressed", pressed);
        },
      );

      it("条件の種別・弓種を選んでいるとき、的の一覧は、その種別・弓種に当てはまる的だけで開く", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue(FACES);
        const user = await renderWithDistances([], {
          format: "indoor",
          bowType: "compound",
        });
        await user.click(addButton());

        // When
        await user.click(screen.getByTestId("history-distance-dialog-target"));

        // Then
        expect(
          await screen.findByTestId(`target-face-option-${INDOOR_FACE.id}`),
        ).toBeVisible();
        expect(
          screen.queryByTestId(`target-face-option-${OUTDOOR_FACE.id}`),
        ).toBeNull();
        expect(
          screen.getByTestId("target-face-format-select"),
        ).toHaveTextContent(roundsText("formatOption.indoor"));
        expect(
          screen.getByTestId("target-face-bow-type-select"),
        ).toHaveTextContent(roundsText("bowTypeOption.compound"));
      });

      it("的の絞り込み欄で種別を選び直すと、的の一覧が変わる", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue(FACES);
        const user = await renderWithDistances([], {
          format: "indoor",
          bowType: "compound",
        });
        await user.click(addButton());
        await user.click(screen.getByTestId("history-distance-dialog-target"));
        await screen.findByTestId(`target-face-option-${INDOOR_FACE.id}`);

        // When
        await chooseFilter(
          user,
          "target-face-format-select",
          roundsText("targetFaceFilterNone"),
        );
        await chooseFilter(
          user,
          "target-face-bow-type-select",
          roundsText("targetFaceFilterNone"),
        );

        // Then
        expect(
          screen.getByTestId(`target-face-option-${OUTDOOR_FACE.id}`),
        ).toBeVisible();
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
        "%sのとき、的の領域を押しても選べる的はなく、取得もエラーも起きない",
        async (_name, saved) => {
          // Given
          procedures.fetching.savedTargetFaces.mockReturnValue(saved);
          const user = await renderWithDistances();
          await user.click(addButton());
          const fetches = fake.store.loadList.mock.calls.length;

          // When
          await user.click(
            screen.getByTestId("history-distance-dialog-target"),
          );

          // Then
          expect(screen.queryAllByTestId(/^target-face-option-/)).toHaveLength(
            0,
          );
          expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
          expect(screen.queryByRole("alert")).toBeNull();
        },
      );

      it("記憶された的のIDが保存した一覧に無ければ、要約に「的データを取得できません」を出し、その的の条件のまま取得に使う", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue([INDOOR_FACE]);
        const remembered = distanceRow(50, { targetFaceId: OUTDOOR_FACE.id });

        // When
        await renderWithDistances([remembered]);

        // Then
        expect(summaries()[0]).toHaveTextContent(
          roundsText("targetFaceMissing"),
        );
        expect(fake.store.loadList).toHaveBeenCalledExactlyOnceWith(
          conditionWith([remembered]),
          null,
          expect.any(Number),
        );
      });

      it("保存した一覧にない的を指定なしへ変更して適用すると解除する", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue([INDOOR_FACE]);
        const user = await renderWithDistances([
          distanceRow(50, { targetFaceId: OUTDOOR_FACE.id }),
        ]);
        await user.click(screen.getByTestId("history-filter-distance-0"));

        await user.click(screen.getByTestId("history-distance-dialog-target"));
        await user.click(
          await screen.findByTestId("history-distance-dialog-target-none"),
        );
        await user.click(confirmButton());
        await waitForDistanceDialogClosed();
        const missingNotice = screen.queryByText(
          roundsText("targetFaceMissing"),
        );

        // When
        applyFilter();

        // Then
        expect(missingNotice).toBeNull();
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([distanceRow(50)]),
          null,
          expect.any(Number),
        );
      });
    });

    describe("記憶と開閉", () => {
      it("距離の構成は、適用すると条件が記憶に書かれ、確定しただけでは書かれない", async () => {
        // Given
        const user = await renderWithDistances();

        // When
        await addDistance(user, "50", "6");
        const beforeApply = memory.stored();
        applyFilter();

        // Then
        expect(beforeApply).toEqual(DEFAULT_HISTORY_VIEW_STATE);
        expect(memory.stored()).toEqual({
          input: conditionWith([distanceRow(50, { arrowsPerEnd: 6 })]),
        });
      });

      it("記憶された距離の構成で取得し、欄を開いた状態でその行が要約として出て、閉じて開き直しても出る", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue(FACES);
        const remembered = [
          distanceRow(50, {
            arrowsPerEnd: 6,
            targetFaceId: OUTDOOR_FACE.id,
          }),
          distanceRow(30),
        ];
        const user = await renderWithDistances(remembered);

        // When
        const shownFirst = summaryTexts();
        await user.click(screen.getByTestId("history-controls-toggle"));
        await user.click(screen.getByTestId("history-controls-toggle"));

        // Then
        expect(fake.store.loadList).toHaveBeenCalledExactlyOnceWith(
          conditionWith(remembered),
          null,
          expect.any(Number),
        );
        expect(shownFirst).toHaveLength(2);
        expect(summaries()[0]).toHaveTextContent("50m");
        expect(summaries()[0]).toHaveTextContent(
          roundsText("distanceArrowsPerEnd", { arrowsPerEnd: "6" }),
        );
        expect(summaries()[1]).toHaveTextContent("30m");
      });

      it("閉じている間は、距離の構成の要約もエラーも示さず、距離の構成の条件は適用され続ける", async () => {
        // Given
        remember({
          condition: conditionWith([distanceRow(50)]),
        });
        fetchResolves(varied);

        // When
        renderHistory();
        await screen.findByText("夜練習");

        // Then
        expect(screen.queryByTestId("history-filter-distance-0")).toBeNull();
        expect(screen.getByTestId("history-controls-toggle")).toHaveAttribute(
          "aria-expanded",
          "false",
        );
        expect(screen.queryByRole("alert")).toBeNull();
        expect(fake.store.loadList).toHaveBeenCalledExactlyOnceWith(
          conditionWith([distanceRow(50)]),
          null,
          expect.any(Number),
        );
      });
    });
  });

  describe("距離単位", () => {
    const userEvents = () => userEvent.setup();
    const shownCards = () =>
      screen.queryAllByRole("listitem").map((card) => card.textContent);
    const markedText = (distance: number) =>
      roundsText("historyDistanceMarked", { distance: String(distance) });

    // 単位が距離の条件を記憶し、欄を開いて表示を始める。
    async function renderDistanceUnit(
      overrides: Partial<HistoryCondition> = {},
    ) {
      remember({
        condition: {
          ...DEFAULT_HISTORY_CONDITION,
          unit: "distance",
          ...overrides,
        },
      });
      fetchResolves(distances);
      renderHistory();
      await screen.findAllByText("午前練習");
      const user = userEvents();
      await openFilter(user);
      return user;
    }

    const distanceCondition = (
      overrides: Partial<HistoryCondition> = {},
    ): HistoryCondition => ({
      ...DEFAULT_HISTORY_CONDITION,
      unit: "distance",
      ...overrides,
    });

    describe("距離単位のカード", () => {
      it("各件に、ラウンドの名前、実施日、距離、小計を出し、小計が0の件も出す", async () => {
        // Given
        fetchResolves([
          distanceItem("d-1", "round-1", "午前練習", {
            roundDate: "2026-09-15",
            distance: 30,
            total: 320,
          }),
          distanceItem("d-2", "round-1", "午前練習", { total: 0 }),
        ]);
        remember({ condition: distanceCondition() });

        // When
        renderHistory();
        await screen.findAllByText("午前練習");

        // Then
        const [first, second] = screen.getAllByRole("listitem");
        expect(first).toHaveTextContent("2026/09/15");
        expect(first).toHaveTextContent(markedText(30));
        expect(first.textContent).toMatch(/320$/);
        expect(second.textContent).toMatch(/(?<!\d)0$/);
      });

      it("同じラウンドの複数の距離を別のカードで、サーバーが返した並びのまま表示し、端末で並べ直さない", async () => {
        // Given
        remember({ condition: distanceCondition() });
        fetchResolves(distances);

        // When
        renderHistory();
        await screen.findAllByText("午前練習");

        // Then
        const cards = shownCards();
        expect(cards).toHaveLength(3);
        expect(cards[0]).toContain(markedText(30));
        expect(cards[1]).toContain("午後練習");
        expect(cards[2]).toContain(markedText(50));
      });

      it("距離単位のカードには、削除のメニューが無い", async () => {
        // Given
        remember({ condition: distanceCondition() });
        fetchResolves(distances);

        // When
        renderHistory();
        await screen.findAllByText("午前練習");

        // Then
        expect(screen.queryByTestId("round-menu-trigger")).toBeNull();
      });

      it("単位がラウンドのカードには、削除のメニューが残る", async () => {
        // Given
        fetchResolves(completed);

        // When
        renderHistory();
        await screen.findByText("午前練習");

        // Then
        expect(screen.getAllByTestId("round-menu-trigger")).toHaveLength(2);
      });
    });

    describe("距離の行の欄", () => {
      const selectButton = () =>
        screen.queryByTestId("history-filter-distance-select");
      const summary = () => screen.queryByTestId("history-filter-distance-row");

      it("単位が距離のときは、距離の行が未指定なら「距離を選択」のボタンだけが出て、追加の入り口は出ない", async () => {
        // Given

        // When
        await renderDistanceUnit();

        // Then
        expect(selectButton()).toHaveTextContent(
          roundsText("historyFilterDistanceSelect"),
        );
        expect(summary()).toBeNull();
        expect(
          screen.getByText(roundsText("historyFilterDistances")),
        ).toBeInTheDocument();
      });

      it("単位がラウンドのときは、「距離を選択」も距離の行の要約も出ない", async () => {
        // Given

        // When
        await renderOpenedHistory();

        // Then
        expect(selectButton()).toBeNull();
        expect(summary()).toBeNull();
      });

      it("「距離を選択」を押すと、削除のないダイアログが「決定」で開き、距離を入れて決定すると、ボタンが要約に替わり、適用して距離の行を持つ条件で取得し、記憶に書く", async () => {
        // Given
        const user = await renderDistanceUnit();
        await user.click(screen.getByTestId("history-filter-distance-select"));
        const opened = {
          confirm: screen.getByTestId("history-distance-dialog-confirm")
            .textContent,
          hasDelete: screen.queryByTestId("history-distance-dialog-delete"),
        };
        await confirmDistanceDialog(user, "50");

        // When
        const shown = { select: selectButton(), summary: summary() };
        applyFilter();

        // Then
        expect(opened.confirm).toBe(roundsText("historyDistanceDecide"));
        expect(opened.hasDelete).toBeNull();
        expect(shown.select).toBeNull();
        expect(shown.summary).toHaveTextContent("50m");
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          distanceCondition({ distanceRow: distanceRow(50) }),
          null,
          expect.any(Number),
        );
        expect(memory.stored()).toEqual({
          input: distanceCondition({ distanceRow: distanceRow(50) }),
        });
      });

      it("選択済みの距離を削除して適用すると距離指定なしで取得する", async () => {
        // Given
        const user = await renderDistanceUnit({ distanceRow: distanceRow(50) });
        await user.click(screen.getByTestId("history-filter-distance-row"));
        await user.clear(dialogInput("distance"));
        await user.type(dialogInput("distance"), "30");
        await user.click(screen.getByTestId("history-distance-dialog-confirm"));
        await waitForDistanceDialogClosed();
        const replaced = summary()?.textContent;

        await user.click(screen.getByTestId("history-filter-distance-row"));
        await user.click(screen.getByTestId("history-distance-dialog-delete"));
        await waitForDistanceDialogClosed();
        const summaryAfterDelete = summary();
        const selectAfterDelete = selectButton();

        // When
        applyFilter();

        // Then
        expect(replaced).toContain("30m");
        expect(summaryAfterDelete).toBeNull();
        expect(selectAfterDelete).not.toBeNull();
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          distanceCondition({ distanceRow: null }),
          null,
          expect.any(Number),
        );
      });

      it("距離が空のまま「決定」を押すと、閉じず、距離の不正を出し、距離の行は指定なしのままである", async () => {
        // Given
        const user = await renderDistanceUnit();
        await user.click(screen.getByTestId("history-filter-distance-select"));

        // When
        await user.click(screen.getByTestId("history-distance-dialog-confirm"));

        // Then
        expect(
          screen.getByTestId("history-distance-dialog-error-distanceInvalid"),
        ).toBeVisible();
        expect(
          screen.getByTestId("history-distance-dialog-confirm"),
        ).toBeVisible();
        expect(summary()).toBeNull();
      });

      it("距離の構成と距離の行を同時に指定すると、取得の条件に両方が入り、互いの値を混ぜない", async () => {
        // Given
        const user = await renderDistanceUnit({
          distances: [distanceRow(30)],
          distanceRow: distanceRow(50),
        });

        // When
        await user.click(screen.getByTestId("history-filter-distance-row"));
        await user.clear(dialogInput("distance"));
        await user.type(dialogInput("distance"), "70");
        await user.click(screen.getByTestId("history-distance-dialog-confirm"));
        await waitForDistanceDialogClosed();
        applyFilter();

        // Then
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          distanceCondition({
            distances: [distanceRow(30)],
            distanceRow: distanceRow(70),
          }),
          null,
          expect.any(Number),
        );
      });
    });

    describe("一覧の末尾と除外", () => {
      it("続きがなく1件以上のときは「該当するラウンドは以上です」を出す", async () => {
        // Given
        remember({ condition: distanceCondition() });
        fetchResolves(distances);

        // When
        renderHistory();
        await screen.findAllByText("午前練習");

        // Then
        expect(
          screen.getByText(roundsText("historyEndDistance")),
        ).toBeInTheDocument();
        expect(screen.queryByText(roundsText("historyEnd"))).toBeNull();
      });

      it("0件のときは「該当するラウンドがありません」だけを出す", async () => {
        // Given
        remember({ condition: distanceCondition() });
        fetchResolves([]);

        // When
        renderHistory();

        // Then
        expect(
          await screen.findByText(roundsText("historyEmpty")),
        ).toBeInTheDocument();
        expect(screen.queryByText(roundsText("historyEndDistance"))).toBeNull();
      });

      it("端末で除いて0件になり、続きがあるときは、空の文言を出さない", async () => {
        // Given
        remember({ condition: distanceCondition() });
        fakeWindow.setLocal({ inProgress: [roundItem("round-2", "午後練習")] });
        fetchResolves([distances[1]], { hasMore: true });

        // When
        renderHistory();
        await waitFor(() => {
          expect(screen.queryByRole("status")).toBeNull();
        });

        // Then
        expect(screen.queryByRole("listitem")).toBeNull();
        expect(screen.queryByText(roundsText("historyEmpty"))).toBeNull();
      });

      it("端末の入力中のラウンドと、削除済みのラウンドに属する距離は、そのラウンドの全ての距離を表示しない", async () => {
        // Given
        remember({ condition: distanceCondition() });
        fakeWindow.setLocal({ inProgress: [roundItem("round-1", "午前練習")] });
        fetchResolves(distances);

        // When
        renderHistory();
        await screen.findByText("午後練習");

        // Then
        expect(screen.queryByText("午前練習")).toBeNull();
        expect(shownCards()).toHaveLength(1);
      });

      it("取得時に求めた削除済みのラウンドに属する距離も表示しない", async () => {
        // Given
        remember({ condition: distanceCondition() });
        fetchResolves(distances, { deleted: new Set(["round-2"]) });

        // When
        renderHistory();
        await screen.findAllByText("午前練習");

        // Then
        expect(screen.queryByText("午後練習")).toBeNull();
        expect(shownCards()).toHaveLength(2);
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
      expect(screen.queryByText(roundsText("historyEndDistance"))).toBeNull();
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
      const keptName = screen.queryByText("午前練習") !== null;
      const offlineNotice =
        screen.queryByText(roundsText("fetchOffline")) !== null;

      // When
      await user.click(retry);

      // Then
      expect(keptName).toBe(true);
      expect(offlineNotice).toBe(true);
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

    it.each([
      ["取得中", () => new Promise(() => {})],
      [
        "取得の失敗",
        () => Promise.resolve({ status: "error", reason: "failed" }),
      ],
      ["オフライン", () => Promise.resolve({ status: "offline" })],
    ])(
      "%sでも、名前「フィルター」のアイコンのボタンが出る",
      async (_name, result) => {
        // Given
        fake.store.loadList.mockReturnValue(result());

        // When
        renderHistory();

        // Then
        const filter = await screen.findByRole("button", {
          name: roundsText("historyFilterTitle"),
        });
        expect(filter).toBeVisible();
        expect(filter.closest("header")).not.toBeNull();
        expect(filter.closest("main")).toBeNull();
      },
    );

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
      procedures.deletion.deleteRound.mockReturnValue(new Promise(() => {}));
      fetchResolves(completed);
      const user = userEvent.setup();
      renderHistory();
      await screen.findByText("午前練習");
      await openDeleteDialog(user, "午前練習");
      const confirmMessageShown =
        screen.queryByText(
          roundsText("roundDeleteConfirmNamed", { name: "午前練習" }),
        ) !== null;

      // When
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then
      expect(confirmMessageShown).toBe(true);
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
