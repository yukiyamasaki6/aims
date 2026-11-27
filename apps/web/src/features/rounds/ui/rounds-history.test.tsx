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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { installFakeViewport } from "@/lib/viewport/fake-viewport-test-helpers";
import { createFakeHistoryViewMemory } from "../application/fake-history-view-memory-test-helpers";
import {
  DEFAULT_HISTORY_CONDITION,
  DEFAULT_HISTORY_INPUT,
  DEFAULT_HISTORY_VIEW_STATE,
  type HistoryCondition,
  type HistoryDistanceError,
  type HistoryDistanceRow,
  type HistoryInput,
  type HistoryRangeError,
  historyViewStateOf,
} from "../domain/history-view-state";
import type {
  DistanceListItem,
  HistoryListItem,
  LoadedRoundsList,
  RoundListItem,
} from "../domain/round-list";
import { seedTargetFace } from "../domain/target-face-test-helpers";
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
  stubCardLayout,
} from "./round-stores-test-helpers";
import {
  RoundProceduresProvider,
  RoundsListStoreProvider,
  RoundWindowProvider,
} from "./rounds-context";
import { RoundsHistory } from "./rounds-history";
import { targetFaceDescription } from "./target-face-label-test-helpers";

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

function renderHistory() {
  // jsdomは幅を測れないため、全ての要素が入る寸法をスタブで与える。
  stubCardLayout();
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

function remember(state: { condition: Partial<HistoryInput> }) {
  memory = createFakeHistoryViewMemory({
    input: { ...DEFAULT_HISTORY_INPUT, ...state.condition },
  });
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

// 表示単位の選択肢。
function unitRadio(unit: "round" | "distance") {
  return screen.getByRole("radio", {
    name: roundsText(
      unit === "round" ? "historyUnitRound" : "historyUnitDistance",
    ),
  });
}

// 表示単位の選択肢を1回押す。
async function chooseUnit(
  user: ReturnType<typeof userEvent.setup>,
  unit: "round" | "distance",
) {
  await user.click(unitRadio(unit));
}

// 適用を押して、編集中の値の検証と確定を起こす。
function leaveRange(_name: string) {
  applyFilter();
}

// 保存した的の一覧。公式の的の実データで、屋外・インドアが混ざる。
const OUTDOOR_FACE = seedTargetFace("A1");
const INDOOR_FACE = seedTargetFace("B1");
const FACES = [OUTDOOR_FACE, INDOOR_FACE];

const OUTDOOR_DESCRIPTION = targetFaceDescription({
  format: "outdoor",
  size: 122,
  bowTypes: ["recurve", "compound", "barebow"],
  minScore: 1,
  maxScore: 10,
  hasX: true,
  tenRadius: 6.1,
  placement: "single",
});
const INDOOR_DESCRIPTION = targetFaceDescription({
  format: "indoor",
  size: 60,
  bowTypes: ["compound"],
  minScore: 1,
  maxScore: 10,
  hasX: false,
  tenRadius: 1.5,
  placement: "single",
});

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

// 開いているダイアログに距離(と射数/エンド)を入れて、確定のボタンを押し、閉じるまで待つ。
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

    it("初期表示(閉)ではフォーカスを動かさない", async () => {
      // Given
      fetchResolves(varied);

      // When
      renderHistory();
      await screen.findByText("夜練習");

      // Then
      expect(document.body).toHaveFocus();
    });

    it("フィルターを開くと入力欄でなくパネルの領域へフォーカスする", async () => {
      // Given
      fetchResolves(varied);
      renderHistory();
      await screen.findByText("夜練習");
      const user = userEvent.setup();

      // When
      await openFilter(user);

      // Then
      const region = screen.getByRole("region", {
        name: roundsText("historyFilterTitle"),
      });
      expect(region).toHaveAttribute("tabindex", "-1");
      expect(document.activeElement).toBe(region);
      expect(rangeInput("scoreMin")).not.toHaveFocus();
    });

    it("開いた後に入力欄をクリックすると、その入力欄がフォーカスを持つ", async () => {
      // Given
      const user = await renderOpenedHistory();

      // When
      await user.click(rangeInput("scoreMin"));

      // Then
      expect(rangeInput("scoreMin")).toHaveFocus();
    });

    it("開いた後にTabを押すと、領域から表示単位の選択中の項目へ進む", async () => {
      // Given
      const user = await renderOpenedHistory();

      // When
      await user.tab();

      // Then
      expect(unitRadio("round")).toHaveFocus();
    });

    it("閉じている間は、領域が不活性で支援技術から隠れ、開くと戻る", async () => {
      // Given
      fetchResolves(varied);
      renderHistory();
      await screen.findByText("夜練習");
      // 閉じている間は不活性で、役割からは探せないため、領域の属性で探す。
      const closed = screen
        .getByTestId("history-controls-toggle")
        .ownerDocument.querySelector(
          `section[aria-label="${roundsText("historyFilterTitle")}"]`,
        ) as HTMLElement;
      const closedState = {
        inert: closed.hasAttribute("inert"),
        hidden: closed.getAttribute("aria-hidden"),
      };

      // When
      await openFilter(userEvent.setup());

      // Then
      expect(closedState).toEqual({ inert: true, hidden: "true" });
      const opened = screen.getByRole("region", {
        name: roundsText("historyFilterTitle"),
      });
      expect(opened).not.toHaveAttribute("inert");
      expect(opened).toHaveAttribute("aria-hidden", "false");
    });

    it("リセットと入力中のEnterは、ブラウザ既定の送信・リセットを止めて、ページ遷移を起こさない", async () => {
      // Given
      await renderOpenedHistory();
      const form = screen.getByTestId("history-controls");

      // When
      const resetContinues = fireEvent.reset(form);
      const submitContinues = fireEvent.submit(form);
      const enterContinues = fireEvent.keyDown(rangeInput("scoreMin"), {
        key: "Enter",
      });

      // Then
      expect(resetContinues).toBe(false);
      expect(submitContinues).toBe(false);
      expect(enterContinues).toBe(false);
    });

    it("種別の選択肢のEscは選択肢だけを閉じて、編集中の値とエラーを保つ", async () => {
      // Given
      const user = await renderOpenedHistory();
      draftRange("scoreMin", "9");
      draftRange("scoreMax", "1");
      applyFilter();
      await user.click(screen.getByTestId("history-filter-format"));
      await screen.findAllByRole("option");

      // When
      await user.keyboard("{Escape}");

      // Then
      await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
      expect(
        screen.getByRole("region", { name: roundsText("historyFilterTitle") }),
      ).toBeInTheDocument();
      expect(rangeInput("scoreMin")).toHaveValue("9");
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    });

    it("一覧メニューのEscはメニューだけを閉じて、フィルターの下書きとエラーを保つ", async () => {
      // Given
      const user = await renderOpenedHistory();
      draftRange("scoreMin", "9");
      draftRange("scoreMax", "1");
      applyFilter();
      const item = screen.getByText("夜練習").closest("li");
      if (!item) throw new Error("round item not found");
      await user.click(within(item).getByTestId("round-menu-trigger"));
      await screen.findByTestId("round-delete");

      // When
      await user.keyboard("{Escape}");

      // Then
      await waitFor(() =>
        expect(screen.queryByTestId("round-delete")).toBeNull(),
      );
      expect(
        screen.getByRole("region", { name: roundsText("historyFilterTitle") }),
      ).toBeInTheDocument();
      expect(rangeInput("scoreMin")).toHaveValue("9");
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    });

    it("距離のダイアログを開くと入力欄でなくダイアログがフォーカスを持ち、Escは的の選択肢、ダイアログの順に一段ずつ閉じて「距離を追加」へ戻る", async () => {
      // Given
      const user = await renderOpenedHistory();
      draftRange("scoreMin", "9");
      draftRange("scoreMax", "1");
      applyFilter();
      const add = screen.getByTestId("history-filter-distance-add");

      // When
      await user.click(add);
      const dialog = await screen.findByRole("dialog");
      await waitFor(() => expect(document.activeElement).toBe(dialog));
      await user.type(dialogInput("distance"), "50");
      await user.click(screen.getByTestId("history-distance-dialog-target"));
      const none = await screen.findByTestId(
        "history-distance-dialog-target-none",
      );
      const targetDialog = none.closest('[role="dialog"]');
      await waitFor(() => expect(document.activeElement).toBe(targetDialog));
      await user.keyboard("{Escape}");

      // Then
      await waitFor(() => expect(none).not.toBeInTheDocument());
      expect(dialogInput("distance")).toHaveValue("50");
      await user.keyboard("{Escape}");
      await waitForDistanceDialogClosed();
      await waitFor(() => expect(add).toHaveFocus());
      expect(rangeInput("scoreMin")).toHaveValue("9");
    });

    it.each([
      ["ラウンド", "history-filter-distance-add", "history-filter-distance-0"],
      ["距離", "history-filter-distance-select", "history-filter-distance-row"],
    ])(
      "%s単位で距離を確定してから削除すると、確定後は要約へ、削除後は残る起点へフォーカスが戻り、外側は適用されない",
      async (unit, triggerId, summaryId) => {
        // Given
        const user = await renderOpenedHistory();
        if (unit === "距離")
          await user.click(screen.getByTestId("history-unit-distance"));
        const trigger = screen.getByTestId(triggerId);
        const requests = [...fake.store.loadList.mock.calls];

        // When
        await user.click(trigger);
        await confirmDistanceDialog(user, "50");
        const afterConfirm = document.activeElement;
        const summary = screen.getByTestId(summaryId);
        await user.click(summary);
        await user.click(
          await screen.findByTestId("history-distance-dialog-delete"),
        );
        await waitForDistanceDialogClosed();

        // Then
        expect(afterConfirm).toBe(unit === "ラウンド" ? trigger : summary);
        expect(screen.queryByTestId(summaryId)).toBeNull();
        await waitFor(() => expect(trigger).toHaveFocus());
        expect(fake.store.loadList.mock.calls).toEqual(requests);
        expect(screen.queryByTestId("history-controls-active")).toBeNull();
      },
    );

    it("表示単位の選択中の項目からTabを押すと、先頭の行のリセットのアイコンへ進む", async () => {
      // Given
      const user = await renderOpenedHistory();
      unitRadio("round").focus();

      // When
      await user.tab();

      // Then
      expect(filterAction("reset")).toHaveFocus();
    });

    it("距離単位では、ラウンド構成の距離は隠れて距離の行に選んだ距離が出て、ラウンドへ戻すと下書きのラウンド構成の距離が出る", async () => {
      // Given
      const user = await renderOpenedHistory();
      await addDistance(user, "18");

      // When
      await chooseUnit(user, "distance");
      await selectDistance(user, "30");
      const shownInDistance = {
        roundRow: screen.queryByTestId("history-filter-distance-0"),
        row: screen.getByTestId("history-filter-distance-row").textContent,
      };
      await chooseUnit(user, "round");

      // Then
      expect(shownInDistance.roundRow).toBeNull();
      expect(shownInDistance.row).toContain("30m");
      expect(screen.getByTestId("history-filter-distance-0")).toHaveTextContent(
        "18m",
      );
      expect(screen.queryByTestId("history-filter-distance-row")).toBeNull();
    });

    it.each(["round", "distance"] as const)(
      "開いてTabを押すと、領域から表示単位の選択中の項目(%s)へ進む",
      async (unit) => {
        // Given
        remember({ condition: { unit } });
        fetchResolves(unit === "round" ? varied : distances);
        renderHistory();
        await screen.findAllByText(unit === "round" ? "夜練習" : "午前練習");
        const user = userEvent.setup();

        // When
        await openFilter(user);
        await user.tab();

        // Then
        expect(unitRadio(unit)).toHaveFocus();
      },
    );

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

    it("0件のときは、カードがなく、0件の文言「該当するラウンドがありません」だけを表示する", async () => {
      // Given
      fetchResolves([]);

      // When
      renderHistory();

      // Then
      expect(
        await screen.findByText("該当するラウンドがありません"),
      ).toBeInTheDocument();
      expect(screen.queryAllByRole("listitem")).toHaveLength(0);
      expect(screen.queryByText(roundsText("historyEnd"))).toBeNull();
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

    describe("リセットのアイコンと展開中の漏斗", () => {
      const orientations = [
        ["縦長", false],
        ["横長", true],
      ] as const;
      const resetIcon = () =>
        within(
          screen.getByRole("region", {
            name: roundsText("historyFilterTitle"),
          }),
        ).getAllByRole("button", { name: roundsText("historyControlsReset") });
      // 見た目の出力は、開閉の状態そのものである`aria-expanded`を除いたクラスで比べる。
      const funnelLook = () => toggle().className;

      it.each(orientations)(
        "%sで開くと、先頭の行に名前「リセット」のボタンが1つあり、閉じる専用のボタンはなく、下部の行は検索だけである",
        async (_orientation, landscape) => {
          // Given
          viewport.setLandscape(landscape);

          // When
          await renderOpenedHistory();

          // Then
          const region = screen.getByRole("region", {
            name: roundsText("historyFilterTitle"),
          });
          expect(resetIcon()).toHaveLength(1);
          expect(resetIcon()[0]).toHaveAttribute("type", "reset");
          expect(
            within(region).queryByRole("button", { name: "閉じる" }),
          ).toBeNull();
          expect(
            within(region).getByRole("button", {
              name: roundsText("historyControlsApply"),
            }),
          ).toBeInTheDocument();
          expect(
            within(region).getAllByRole("button", {
              name: roundsText("historyControlsReset"),
            }),
          ).toHaveLength(1);
        },
      );

      it.each(orientations)(
        "%sで漏斗を再び押すと、未適用の変更とエラーを破棄して閉じ、漏斗へフォーカスが戻り、取得も記憶もしない",
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
          await user.click(toggle());

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

      it("横長で検索して開いたままでも、漏斗の再押下で閉じ、検索した条件は残り、検索後の未適用の変更だけを破棄する", async () => {
        // Given
        viewport.setLandscape(true);
        const user = await renderOpenedHistory();
        draftRange("scoreMin", "5");
        await user.click(filterAction("apply"));
        draftRange("scoreMin", "9");

        // When
        await user.click(toggle());

        // Then
        expect(panel()).toBeNull();
        expect(toggle()).toHaveFocus();
        expect(memory.stored().input.scoreMin).toBe(5);
        expect(mark()).not.toBeNull();
        await openFilter(user);
        expect(rangeInput("scoreMin")).toHaveValue("5");
      });

      it("漏斗の再押下で閉じても、検索もリセットも起きない", async () => {
        // Given
        const user = await renderOpenedHistory();
        draftRange("scoreMin", "5");
        const requests = [...fake.store.loadList.mock.calls];

        // When
        await user.click(toggle());

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
      it("初期値は、種別・弓種が指定なし、日付順が新しい順、得点順が指定なし、表示単位が「ラウンド」で、各欄が項目名を持つ", async () => {
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
          screen.getByRole("radio", { name: roundsText("historyUnitRound") }),
        ).toHaveAttribute("aria-checked", "true");
        expect(
          screen.getByRole("radio", {
            name: roundsText("historyUnitDistance"),
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

      it("リセットすると、編集中の値(エラー、両単位の得点の範囲、ラウンド構成と選んだ距離を含む)が既定に戻り、要約が消えて「距離を追加」だけになり、パネルは閉じず、入力値も取得も変わらない", async () => {
        // Given
        remember({
          condition: {
            ...DEFAULT_HISTORY_CONDITION,
            format: "indoor",
            scoreMin: 100,
            distanceScoreMin: 20,
            distances: [distanceRow(50)],
          },
        });
        const user = await renderOpenedHistory();
        const fetches = fake.store.loadList.mock.calls.length;
        const before = memory.stored();
        await chooseUnit(user, "distance");
        await selectDistance(user, "30");
        draftRange("scoreMin", "9");
        draftRange("scoreMax", "1");
        applyFilter();

        // When
        await user.click(filterAction("reset"));

        // Then
        expect(panel()).not.toBeNull();
        expect(selectedOf(FORMAT_TEST_ID)).toBe(
          roundsText("historyFilterNone"),
        );
        expect(unitRadio("round")).toHaveAttribute("aria-checked", "true");
        for (const field of ["dateFrom", "dateTo", "scoreMin", "scoreMax"]) {
          expect(rangeInput(field)).toHaveValue("");
        }
        await chooseUnit(user, "distance");
        for (const field of ["scoreMin", "scoreMax"]) {
          expect(rangeInput(field)).toHaveValue("");
        }
        await chooseUnit(user, "round");
        expect(screen.queryByTestId("history-filter-distance-0")).toBeNull();
        expect(screen.getByTestId("history-filter-distance-add")).toBeVisible();
        expect(
          screen.queryByTestId("history-filter-distance-select"),
        ).toBeNull();
        expect(screen.queryByTestId("history-filter-distance-row")).toBeNull();
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

    describe("表示単位と絞り込む距離", () => {
      const selectButton = () =>
        screen.queryByTestId("history-filter-distance-select");
      const summary = () => screen.queryByTestId("history-filter-distance-row");
      const lastCondition = () => fake.store.loadList.mock.calls.at(-1)?.[0];

      it("「距離」を1回押すと単位が切り替わり、ラウンド構成の欄が距離の指定の欄に入れ替わる", async () => {
        // Given
        const user = await renderOpenedHistory();
        const before = {
          add: screen.queryByTestId("history-filter-distance-add"),
          select: selectButton(),
        };

        // When
        await chooseUnit(user, "distance");

        // Then
        expect(before.add).not.toBeNull();
        expect(before.select).toBeNull();
        expect(unitRadio("distance")).toHaveAttribute("aria-checked", "true");
        expect(screen.queryByTestId("history-filter-distance-add")).toBeNull();
        expect(selectButton()).toHaveAccessibleName(
          roundsText("historyFilterDistanceSelect"),
        );
      });

      it("得点の範囲は単位ごとに保たれ、切り替えても他方の値は変わらない", async () => {
        // Given
        const user = await renderOpenedHistory();
        draftRange("scoreMin", "300");

        // When
        await chooseUnit(user, "distance");
        const distanceInitial = (rangeInput("scoreMin") as HTMLInputElement)
          .value;
        draftRange("scoreMin", "50");
        await chooseUnit(user, "round");

        // Then
        expect(distanceInitial).toBe("");
        expect(rangeInput("scoreMin")).toHaveValue("300");
        await chooseUnit(user, "distance");
        expect(rangeInput("scoreMin")).toHaveValue("50");
      });

      it("検索で表示中の単位の得点の範囲だけを確定し、もう一方は入力値のままにし、その単位を表示して検索すると反映する", async () => {
        // Given
        viewport.setLandscape(true);
        remember({ condition: { scoreMin: 1, distanceScoreMin: 2 } });
        const user = await renderOpenedHistory();
        draftRange("scoreMin", "300");
        await chooseUnit(user, "distance");
        draftRange("scoreMin", "50");

        // When
        await user.click(filterAction("apply"));
        const afterDistance = memory.stored().input;
        await chooseUnit(user, "round");
        await user.click(filterAction("apply"));
        const afterRound = memory.stored().input;

        // Then
        expect([
          afterDistance.scoreMin,
          afterDistance.distanceScoreMin,
        ]).toEqual([1, 50]);
        expect([afterRound.scoreMin, afterRound.distanceScoreMin]).toEqual([
          300, 50,
        ]);
      });

      it("検索で範囲のエラーが出た後に単位を切り替えるとエラーが消え、入力した文字は残り、元の単位に戻して検索するとまたエラーが出る", async () => {
        // Given
        viewport.setLandscape(true);
        const user = await renderOpenedHistory();
        draftRange("scoreMin", "9");
        draftRange("scoreMax", "1");
        await user.click(filterAction("apply"));
        const errorBefore = screen.queryByRole("alert");

        // When
        await chooseUnit(user, "distance");
        const errorOnOtherUnit = screen.queryByRole("alert");
        await chooseUnit(user, "round");
        const errorAfterReturn = screen.queryByRole("alert");
        const kept = [
          (rangeInput("scoreMin") as HTMLInputElement).value,
          (rangeInput("scoreMax") as HTMLInputElement).value,
        ];
        await user.click(filterAction("apply"));

        // Then
        expect(errorBefore).not.toBeNull();
        expect(errorOnOtherUnit).toBeNull();
        expect(errorAfterReturn).toBeNull();
        expect(kept).toEqual(["9", "1"]);
        expect(screen.queryByRole("alert")).not.toBeNull();
      });

      it("検索で期間と得点のエラーが出た後に単位を切り替えると、得点のエラーだけが消え、期間のエラーは残る", async () => {
        // Given
        viewport.setLandscape(true);
        const user = await renderOpenedHistory();
        draftRange("dateFrom", "2026-06-01");
        draftRange("dateTo", "2026-05-01");
        draftRange("scoreMin", "9");
        draftRange("scoreMax", "1");
        await user.click(filterAction("apply"));
        const before = {
          date: screen.queryByTestId("history-filter-error-dateOrder"),
          score: screen.queryByTestId("history-filter-error-scoreOrder"),
        };

        // When
        await chooseUnit(user, "distance");

        // Then
        expect(before.date).not.toBeNull();
        expect(before.score).not.toBeNull();
        expect(
          screen.queryByTestId("history-filter-error-dateOrder"),
        ).not.toBeNull();
        expect(
          screen.queryByTestId("history-filter-error-scoreOrder"),
        ).toBeNull();
      });

      it("表示していない単位の得点の入力が不正でも、検索は成功し、その単位の入力値は変わらない", async () => {
        // Given
        viewport.setLandscape(true);
        remember({ condition: { distanceScoreMin: 2 } });
        const user = await renderOpenedHistory();
        await chooseUnit(user, "distance");
        draftRange("scoreMin", "9");
        draftRange("scoreMax", "1");
        await chooseUnit(user, "round");
        draftRange("scoreMin", "300");

        // When
        await user.click(filterAction("apply"));

        // Then
        expect(screen.queryByRole("alert")).toBeNull();
        expect(memory.stored().input.scoreMin).toBe(300);
        expect(memory.stored().input.distanceScoreMin).toBe(2);
      });

      it("距離単位で検索すると、取得の条件は距離単位の得点の範囲だけを持ち、ラウンド構成を渡さない", async () => {
        // Given
        remember({
          condition: {
            scoreMin: 300,
            scoreMax: 600,
            distanceScoreMin: 20,
            distanceScoreMax: 90,
            distances: [distanceRow(50)],
          },
        });
        const user = await renderOpenedHistory();
        await chooseUnit(user, "distance");

        // When
        applyFilter();

        // Then
        expect(lastCondition()).toEqual({
          ...DEFAULT_HISTORY_CONDITION,
          unit: "distance",
          scoreMin: 20,
          scoreMax: 90,
          distances: [],
        });
      });

      it("ラウンド単位で検索すると、取得の条件はラウンド単位の得点の範囲だけを持ち、距離の指定を渡さない", async () => {
        // Given
        remember({
          condition: {
            unit: "distance",
            scoreMin: 300,
            scoreMax: 600,
            distanceScoreMin: 20,
            distanceScoreMax: 90,
            distanceRow: distanceRow(50),
          },
        });
        fetchResolves(distances);
        renderHistory();
        await screen.findAllByText("午前練習");
        const user = userEvent.setup();
        await openFilter(user);
        await chooseUnit(user, "round");

        // When
        applyFilter();

        // Then
        expect(lastCondition()).toEqual({
          ...DEFAULT_HISTORY_CONDITION,
          unit: "round",
          scoreMin: 300,
          scoreMax: 600,
          distanceRow: null,
        });
      });

      it("距離単位で、ラウンド単位の得点の範囲だけを変えて検索しても、取得し直さず、印も変わらない", async () => {
        // Given
        viewport.setLandscape(true);
        remember({ condition: { unit: "distance" } });
        fetchResolves(distances);
        renderHistory();
        await screen.findAllByText("午前練習");
        const user = userEvent.setup();
        await openFilter(user);
        const fetches = fake.store.loadList.mock.calls.length;
        const markBefore = mark();
        await chooseUnit(user, "round");
        draftRange("scoreMin", "300");
        await chooseUnit(user, "distance");

        // When
        await user.click(filterAction("apply"));

        // Then
        expect(memory.stored().input.scoreMin).toBeNull();
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
        expect(mark()).toBe(markBefore);
      });

      it("距離単位で、ラウンド構成だけを変えて検索しても、入力値は更新して記憶へ書くが、取得し直さず、印も変わらない", async () => {
        // Given
        viewport.setLandscape(true);
        remember({ condition: { unit: "distance" } });
        fetchResolves(distances);
        renderHistory();
        await screen.findAllByText("午前練習");
        const user = userEvent.setup();
        await openFilter(user);
        const fetches = fake.store.loadList.mock.calls.length;
        const markBefore = mark();
        await chooseUnit(user, "round");
        await addDistance(user, "50");
        await chooseUnit(user, "distance");

        // When
        await user.click(filterAction("apply"));

        // Then
        expect(memory.stored().input.distances).toEqual([distanceRow(50)]);
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
        expect(mark()).toBe(markBefore);
      });

      it("ラウンド単位で、距離の指定と距離単位の得点の範囲だけを指定して適用した状態は、印が出ない", async () => {
        // Given
        remember({
          condition: {
            unit: "round",
            distanceScoreMin: 20,
            distanceRow: distanceRow(50),
          },
        });

        // When
        fetchResolves(varied);
        renderHistory();
        await screen.findByText("夜練習");

        // Then
        expect(mark()).toBeNull();
      });

      it("保存した単位ごとの得点の範囲が、開いたときに表示中の単位の欄へ入り、切り替えると他方の値が出る", async () => {
        // Given
        remember({
          condition: { scoreMin: 300, scoreMax: 600, distanceScoreMin: 20 },
        });
        const user = await renderOpenedHistory();

        // When
        const roundValues = [
          (rangeInput("scoreMin") as HTMLInputElement).value,
          (rangeInput("scoreMax") as HTMLInputElement).value,
        ];
        await chooseUnit(user, "distance");

        // Then
        expect(roundValues).toEqual(["300", "600"]);
        expect(rangeInput("scoreMin")).toHaveValue("20");
        expect(rangeInput("scoreMax")).toHaveValue("");
      });

      it("距離単位をラウンドへ戻すと距離の選択を隠し、適用前の取得を起こさない", async () => {
        // Given
        const user = await renderOpenedHistory();
        const fetches = fake.store.loadList.mock.calls.length;

        await chooseUnit(user, "distance");
        const selectLabelOn = selectButton()?.textContent;
        const fetchesOn = fake.store.loadList.mock.calls.length;

        // When
        await chooseUnit(user, "round");

        // Then
        expect(selectLabelOn).toBe(roundsText("historyFilterDistanceSelect"));
        expect(fetchesOn).toBe(fetches);
        expect(selectButton()).toBeNull();
      });

      it("距離単位で検索した後、ラウンドへ戻して検索するとラウンド条件を取得する", async () => {
        // Given
        const user = await renderOpenedHistory();
        await chooseUnit(user, "distance");

        applyFilter();

        const distanceCondition = lastCondition();
        await waitFor(() => expect(panel()).toBeNull());
        await openFilter(user);
        const distanceChecked =
          unitRadio("distance").getAttribute("aria-checked");
        await chooseUnit(user, "round");

        // When
        applyFilter();

        // Then
        expect(distanceCondition).toEqual({
          ...DEFAULT_HISTORY_CONDITION,
          unit: "distance",
        });
        expect(distanceChecked).toBe("true");
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          DEFAULT_HISTORY_CONDITION,
          null,
          expect.any(Number),
        );
      });

      it("ラウンドを選ぶと、選んだ距離の要約は隠れるが距離の行は編集中の値に保たれ、距離へ戻すと要約が復元される", async () => {
        // Given
        const user = await renderOpenedHistory();
        await chooseUnit(user, "distance");
        await selectDistance(user, "50");

        // When
        await chooseUnit(user, "round");
        const hidden = summary();
        await chooseUnit(user, "distance");

        // Then
        expect(hidden).toBeNull();
        expect(summary()).toHaveTextContent("50m");
      });

      it("ラウンド単位で保持した距離は、開き直して距離単位へ戻すと要約に復元する", async () => {
        // Given
        const user = await renderOpenedHistory();
        const fetches = fake.store.loadList.mock.calls.length;
        await chooseUnit(user, "distance");
        await selectDistance(user, "50");
        await chooseUnit(user, "round");

        applyFilter();

        await waitFor(() => expect(panel()).toBeNull());
        const fetchesAfterApply = fake.store.loadList.mock.calls.length;
        const markAfterApply = mark();
        const storedRow = memory.stored().input.distanceRow;
        await openFilter(user);

        // When
        await chooseUnit(user, "distance");

        // Then
        expect(fetchesAfterApply).toBe(fetches);
        expect(markAfterApply).toBeNull();
        expect(storedRow).toEqual(distanceRow(50));
        expect(summary()).toHaveTextContent("50m");
      });

      it("保持した距離で距離単位を再適用すると取得条件へ戻る", async () => {
        // Given
        remember({
          condition: { unit: "distance", distanceRow: distanceRow(50) },
        });
        fetchResolves(distances);
        renderHistory();
        await screen.findAllByText("午前練習");
        const user = userEvent.setup();
        await openFilter(user);
        await chooseUnit(user, "round");

        applyFilter();

        const roundCondition = lastCondition();
        const storedRow = memory.stored().input.distanceRow;
        await waitFor(() => expect(panel()).toBeNull());
        await openFilter(user);
        await chooseUnit(user, "distance");
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

      it("旧い形の保存値(sortKey=score、unit=distance、filterOpen)は、読み替えられず、既定の入力値で復元され、表示単位は「ラウンド」である", async () => {
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
        expect(unitRadio("round")).toHaveAttribute("aria-checked", "true");
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
          ...DEFAULT_HISTORY_INPUT,
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
        expect(addButton()).toHaveAccessibleName(roundsText("addDistance"));
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

      it("距離だけを入れて「追加」を押すと、ダイアログが閉じ、距離のタイルが出て、適用前は取得も記憶の変更も起きない", async () => {
        // Given
        const user = await renderWithDistances();
        const fetches = fake.store.loadList.mock.calls.length;

        // When
        await addDistance(user, "50");

        // Then
        expect(summaries()).toHaveLength(1);
        expect(summaries()[0]).toHaveTextContent("50m");
        expect(fake.store.loadList).toHaveBeenCalledTimes(fetches);
        expect(memory.stored()).toEqual(DEFAULT_HISTORY_VIEW_STATE);
      });

      it("射数/エンドを指定して確定すると、要約に距離と「N射」が出る", async () => {
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

      it("的を選択済みの距離を確定すると距離のタイルに的の図を表示する", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue(FACES);
        const user = await renderWithDistances();
        await user.click(addButton());
        await user.type(dialogInput("distance"), "50");
        await user.type(dialogInput("arrowsPerEnd"), "6");

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
        expect(summaries()[0].querySelector("svg")).not.toBeNull();
      });

      it("距離のタイルは上から距離、射数/エンド、的の順で、的の図を出す", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue(FACES);
        const remembered = distanceRow(50, {
          arrowsPerEnd: 6,
          targetFaceId: OUTDOOR_FACE.id,
        });

        // When
        await renderWithDistances([remembered]);

        // Then
        const tile = summaries()[0];
        expect(tile.textContent).toMatch(
          new RegExp(
            `50m.*${roundsText("distanceArrowsPerEnd", { arrowsPerEnd: "6" })}`,
          ),
        );
        expect(tile.querySelector("svg")).not.toBeNull();
      });

      it("的が保存した一覧に無いタイルは、射数/エンドを出したまま「的データを取得できません」を出す", async () => {
        // Given
        procedures.fetching.savedTargetFaces.mockReturnValue([INDOOR_FACE]);

        // When
        await renderWithDistances([
          distanceRow(50, { arrowsPerEnd: 6, targetFaceId: OUTDOOR_FACE.id }),
        ]);

        // Then
        const tile = summaries()[0];
        expect(tile).toHaveTextContent(roundsText("targetFaceMissing"));
        expect(tile).toHaveTextContent(
          roundsText("distanceArrowsPerEnd", { arrowsPerEnd: "6" }),
        );
      });

      it("「距離を追加」は最後のタイルの次にあり、追加・削除のたびに末尾に残り、タイルの件数には数えない", async () => {
        // Given
        const user = await renderWithDistances();
        const isAfterLastTile = () => {
          const tiles = summaries();
          const last = tiles[tiles.length - 1];
          return (
            last === undefined ||
            Boolean(
              last.compareDocumentPosition(addButton()) &
                Node.DOCUMENT_POSITION_FOLLOWING,
            )
          );
        };

        // When
        const positions = [isAfterLastTile()];
        await addDistance(user, "50");
        positions.push(isAfterLastTile());
        await addDistance(user, "30");
        positions.push(isAfterLastTile());
        await user.click(screen.getByTestId("history-filter-distance-0"));
        await user.click(screen.getByTestId("history-distance-dialog-delete"));
        await waitForDistanceDialogClosed();
        positions.push(isAfterLastTile());

        // Then
        expect(positions).toEqual([true, true, true, true]);
        expect(summaries()).toHaveLength(1);
        expect(summaries()[0]).toHaveTextContent("30m");
        expect(addButton()).toBeVisible();
        applyFilter();
        expect(fake.store.loadList).toHaveBeenLastCalledWith(
          conditionWith([distanceRow(30)]),
          null,
          expect.any(Number),
        );
      });

      it("Tabでタイルを射つ順に進んだ次が「距離を追加」で、Enterでタイルは編集の、追加は追加のダイアログを開き、閉じると起点へフォーカスが戻る", async () => {
        // Given
        const user = await renderWithDistances([
          distanceRow(50),
          distanceRow(30),
        ]);
        screen.getByTestId("history-filter-distance-0").focus();

        // When
        await user.tab();
        const second = document.activeElement;
        await user.tab();
        const third = document.activeElement;
        await user.keyboard("{Enter}");
        const addOpened = (
          await screen.findByTestId("history-distance-dialog-confirm")
        ).textContent;
        await user.keyboard("{Escape}");
        await waitForDistanceDialogClosed();
        await user.click(screen.getByTestId("history-filter-distance-1"));
        const editOpened = dialogInput("distance");
        const editValue = (editOpened as HTMLInputElement).value;
        await user.keyboard("{Escape}");
        await waitForDistanceDialogClosed();

        // Then
        expect(second).toBe(screen.getByTestId("history-filter-distance-1"));
        expect(third).toBe(addButton());
        expect(addOpened).toBe(roundsText("historyDistanceAdd"));
        expect(editValue).toBe("30");
        await waitFor(() =>
          expect(screen.getByTestId("history-filter-distance-1")).toHaveFocus(),
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

      it("射数/エンドを入れた確定は射数/エンドの値で、空の確定はnullで、取得の条件の行になる", async () => {
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
        ["射数/エンドが範囲外(13)", "50", "13", "arrowsPerEndInvalid"],
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

      it("距離と射数/エンドの両方が不正なときは、両方の欄の下にエラーを出し、どちらも入力できる", async () => {
        // Given
        const user = await renderWithDistances();
        await user.click(addButton());
        await user.type(dialogInput("distance"), "101");
        await user.type(dialogInput("arrowsPerEnd"), "13");

        // When
        await user.click(confirmButton());

        // Then
        expect(dialogError("distanceInvalid")).not.toBeNull();
        expect(dialogError("arrowsPerEndInvalid")).not.toBeNull();
        await user.clear(dialogInput("distance"));
        await user.type(dialogInput("distance"), "50");
        expect(dialogInput("distance")).toHaveValue("50");
        expect(confirmButton()).toBeInTheDocument();
      });

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

      describe("読み上げ", () => {
        // 保存した一覧と指定中の的を決めて、その距離のダイアログを開く手前まで表示する。
        async function renderDistance(
          saved: typeof FACES,
          targetFaceId: string | null,
        ) {
          procedures.fetching.savedTargetFaces.mockReturnValue(saved);
          return renderWithDistances([distanceRow(50, { targetFaceId })]);
        }

        const openDistance = (user: ReturnType<typeof userEvent.setup>) =>
          user.click(screen.getByTestId("history-filter-distance-0"));
        const targetButton = () =>
          screen.getByTestId("history-distance-dialog-target");

        const states: [string, typeof FACES, string | null, string][] = [
          [
            "指定済み",
            FACES,
            OUTDOOR_FACE.id,
            roundsText("targetFaceTrigger", { name: OUTDOOR_DESCRIPTION }),
          ],
          ["未指定", FACES, null, roundsText("targetFaceTriggerNone")],
          [
            "保存した一覧に無い的",
            [INDOOR_FACE],
            OUTDOOR_FACE.id,
            roundsText("targetFaceTriggerMissing"),
          ],
        ];

        it.each(states)(
          "的が%sのとき、閉じた状態の的のボタンは、名前が「的」で、状態の説明を持つ",
          async (_state, saved, targetFaceId, description) => {
            // Given
            const user = await renderDistance(saved, targetFaceId);

            // When
            await openDistance(user);

            // Then
            expect(targetButton()).toHaveAccessibleName(
              roundsText("historyFilterTarget"),
            );
            expect(targetButton()).toHaveAccessibleDescription(description);
            expect(targetButton()).toHaveAttribute("aria-expanded", "false");
            expect(targetButton()).toHaveAttribute("aria-haspopup", "dialog");
          },
        );

        it.each(states)(
          "的が%sのとき、的のボタンを押すと、開いた状態になる",
          async (_state, saved, targetFaceId) => {
            // Given
            const user = await renderDistance(saved, targetFaceId);
            await openDistance(user);

            // When
            await user.click(targetButton());

            // Then
            expect(targetButton()).toHaveAttribute("aria-expanded", "true");
          },
        );

        it("的を選ぶと、的のボタンは名前が「的」のまま、説明が選んだ的の説明になる", async () => {
          // Given
          const user = await renderDistance(FACES, OUTDOOR_FACE.id);
          await openDistance(user);
          await user.click(targetButton());

          // When
          await user.click(
            await screen.findByTestId(`target-face-option-${INDOOR_FACE.id}`),
          );

          // Then
          expect(targetButton()).toHaveAccessibleName(
            roundsText("historyFilterTarget"),
          );
          expect(targetButton()).toHaveAccessibleDescription(
            roundsText("targetFaceTrigger", { name: INDOOR_DESCRIPTION }),
          );
        });

        it("指定済みの的から「指定なし」を選ぶと、的のボタンの説明が指定なしの案内になる", async () => {
          // Given
          const user = await renderDistance(FACES, OUTDOOR_FACE.id);
          await openDistance(user);
          await user.click(targetButton());

          // When
          await user.click(
            await screen.findByTestId("history-distance-dialog-target-none"),
          );

          // Then
          expect(targetButton()).toHaveAccessibleDescription(
            roundsText("targetFaceTriggerNone"),
          );
        });

        it("的の一覧の各候補は、的の説明を名前に持つ", async () => {
          // Given
          const user = await renderDistance(FACES, null);
          await openDistance(user);

          // When
          await user.click(targetButton());

          // Then
          expect(
            await screen.findByTestId(`target-face-option-${OUTDOOR_FACE.id}`),
          ).toHaveAccessibleName(OUTDOOR_DESCRIPTION);
          expect(
            screen.getByTestId(`target-face-option-${INDOOR_FACE.id}`),
          ).toHaveAccessibleName(INDOOR_DESCRIPTION);
        });
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
          input: {
            ...DEFAULT_HISTORY_INPUT,
            distances: [distanceRow(50, { arrowsPerEnd: 6 })],
          },
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

      it("単位が距離のときは、距離の行が未指定なら「距離を選択」のボタンだけが出て、追加の入り口とラウンド構成の欄は出ない", async () => {
        // Given

        // When
        await renderDistanceUnit();

        // Then
        expect(selectButton()).toHaveTextContent(
          roundsText("historyFilterDistanceSelect"),
        );
        expect(summary()).toBeNull();
        expect(screen.queryByTestId("history-filter-distance-add")).toBeNull();
        expect(
          screen.queryByText(roundsText("historyFilterDistances")),
        ).toBeNull();
      });

      it("距離を指定済みの距離単位は距離のタイル1件で、削除すると「距離を選択」に戻り、押すと選択のダイアログが開く", async () => {
        // Given
        const user = await renderDistanceUnit({
          distanceRow: distanceRow(50, { arrowsPerEnd: 6 }),
        });
        const shown = {
          tile: summary()?.textContent,
          select: selectButton(),
        };

        // When
        await user.click(screen.getByTestId("history-filter-distance-row"));
        await user.click(screen.getByTestId("history-distance-dialog-delete"));
        await waitForDistanceDialogClosed();
        await user.click(screen.getByTestId("history-filter-distance-select"));

        // Then
        expect(shown.tile).toContain("50m");
        expect(shown.tile).toContain(
          roundsText("distanceArrowsPerEnd", { arrowsPerEnd: "6" }),
        );
        expect(shown.select).toBeNull();
        expect(summary()).toBeNull();
        expect(
          screen.getByTestId("history-distance-dialog-confirm"),
        ).toHaveTextContent(roundsText("historyDistanceDecide"));
      });

      it("単位が距離のときは、距離の指定の直上に「距離構成」の見出しが、指定の有無によらず出る", async () => {
        // Given

        // When
        await renderDistanceUnit();

        // Then
        const label = screen.getByText(
          roundsText("historyFilterDistanceGroup"),
        );
        expect(
          label.compareDocumentPosition(selectButton() as Node) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(label.parentElement).toContainElement(selectButton());
      });

      it("単位が距離で距離を指定済みのときも、要約の直上に「距離構成」の見出しが出る", async () => {
        // Given

        // When
        await renderDistanceUnit({ distanceRow: distanceRow(50) });

        // Then
        const label = screen.getByText(
          roundsText("historyFilterDistanceGroup"),
        );
        expect(label.parentElement).toContainElement(summary());
      });

      it("単位がラウンドのときは、「ラウンド構成」の見出しが出て、「距離構成」の見出しは出ない", async () => {
        // Given

        // When
        await renderOpenedHistory();

        // Then
        expect(
          screen.getByText(roundsText("historyFilterDistances")),
        ).toBeInTheDocument();
        expect(
          screen.queryByText(roundsText("historyFilterDistanceGroup")),
        ).toBeNull();
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
          input: {
            ...DEFAULT_HISTORY_INPUT,
            ...distanceCondition({ distanceRow: distanceRow(50) }),
          },
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

      it("距離単位では、ラウンド構成が入力値にあっても取得の条件に入れず、距離の行だけが入り、入力値のラウンド構成は保たれる", async () => {
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
          distanceCondition({ distances: [], distanceRow: distanceRow(70) }),
          null,
          expect.any(Number),
        );
        expect(memory.stored().input.distances).toEqual([distanceRow(30)]);
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

    it.each([
      ["取得の失敗", { status: "error", reason: "failed" }],
      ["0件", { status: "ok", data: loaded([]) }],
      ["オフライン", { status: "offline" }],
    ])(
      "%sの状態でも、フィルターを開いて条件を編集し、リセットと検索の操作へ届く",
      async (_state, result) => {
        // Given
        fake.store.loadList.mockResolvedValue(result);
        renderHistory();
        const user = userEvent.setup();
        await screen.findByRole("button", {
          name: roundsText("historyFilterTitle"),
        });

        // When
        await openFilter(user);
        await user.type(rangeInput("scoreMin"), "25");
        const edited = (rangeInput("scoreMin") as HTMLInputElement).value;
        await user.click(filterAction("reset"));
        filterAction("apply").focus();

        // Then
        expect(edited).toBe("25");
        expect(rangeInput("scoreMin")).toHaveValue("");
        expect(filterAction("apply")).toHaveFocus();
        expect(
          screen.getByRole("region", {
            name: roundsText("historyFilterTitle"),
          }),
        ).toBeInTheDocument();
      },
    );

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
