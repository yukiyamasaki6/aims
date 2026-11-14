import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode, RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryPagesSnapshot } from "../application/history-pages-memory";
import type { FetchResult } from "../domain/fetch-status";
import {
  DEFAULT_HISTORY_CONDITION,
  type HistoryCondition,
} from "../domain/history-view-state";
import type { LoadedRoundsList } from "../domain/round-list";
import { installFakeIntersectionObserver } from "./intersection-observer-test-helpers";
import {
  fakeSearchParams,
  followReplaceState,
} from "./navigation-test-helpers";
import {
  createFakeRoundProcedures,
  createFakeRoundsListStore,
} from "./round-stores-test-helpers";
import {
  RoundProceduresProvider,
  RoundsListStoreProvider,
} from "./rounds-context";
import { useHistoryPages } from "./use-history-pages";

vi.mock("next/navigation", async () => {
  const { fakeSearchParams: fake } = await import("./navigation-test-helpers");
  return { useSearchParams: fake.useSearchParams };
});

const RETURN_URL = "/rounds/history?return=1";
const scoreCondition: HistoryCondition = {
  ...DEFAULT_HISTORY_CONDITION,
  sortKey: "score",
};

function distanceRow(distance: number) {
  return {
    distance,
    arrowsPerEnd: null,
    totalArrows: null,
    targetFaceId: null,
  };
}

function page(
  ids: string[],
  overrides: Partial<LoadedRoundsList> = {},
): LoadedRoundsList {
  return {
    items: ids.map((id) => ({
      id,
      name: id,
      roundDate: "2026-09-15",
      total: 0,
    })),
    hasMore: false,
    after: ids.at(-1) ?? null,
    deleted: new Set(),
    ...overrides,
  };
}

const ok = (data: LoadedRoundsList): FetchResult<LoadedRoundsList> => ({
  status: "ok",
  data,
});

type Props = {
  condition: HistoryCondition | null;
  removed?: ReadonlySet<string>;
};

// 画面の要素の入れ物(スクロールの入れ物 > 履歴の要素)と、末尾の要素。
function mountElements() {
  const container = document.createElement("div");
  container.style.overflowY = "auto";
  const anchor = document.createElement("div");
  const tail = document.createElement("div");
  anchor.append(tail);
  container.append(anchor);
  document.body.append(container);
  return { container, anchor, tail };
}

// Errorは、取得の関数が拒否することを表す。
type Load =
  | FetchResult<LoadedRoundsList>
  | Promise<FetchResult<LoadedRoundsList>>
  | Error;

type Rig = {
  loads?: Load[];
  // 描画の前に書いておく、戻ったときの表示の記憶。
  stored?: HistoryPagesSnapshot;
  // 描画の前に設定する、端末の記録の削除済みのID。Errorは、読み直しが拒否されることを表す。
  deleted?: Set<string> | Error;
  itemHeight?: number;
  offline?: boolean;
};

// `loads`は、描画の直後から順に起きる取得の結果。使い切った後の取得は終わらない。
function setup(
  initial: Props = { condition: DEFAULT_HISTORY_CONDITION },
  rig: Rig = {},
) {
  const listStore = createFakeRoundsListStore();
  const procedures = createFakeRoundProcedures();
  const { loadList, readDeleted } = listStore.store;
  loadList.mockReturnValue(new Promise(() => {}));
  for (const load of rig.loads ?? []) {
    if (load instanceof Error) loadList.mockRejectedValueOnce(load);
    else loadList.mockReturnValueOnce(Promise.resolve(load));
  }
  if (rig.deleted instanceof Error) readDeleted.mockRejectedValue(rig.deleted);
  else readDeleted.mockResolvedValue(rig.deleted ?? new Set());
  if (rig.stored) procedures.historyPagesMemory.write(rig.stored);
  if (rig.offline) procedures.goOffline();
  const intersection = installFakeIntersectionObserver();
  const elements = mountElements();
  const anchorRef: RefObject<HTMLElement | null> = {
    current: elements.anchor,
  };
  const measureItemHeight = vi.fn(() => rig.itemHeight ?? 100);
  const hook = renderHook(
    ({ condition, removed = new Set<string>() }: Props) =>
      useHistoryPages({ condition, removed, measureItemHeight, anchorRef }),
    {
      initialProps: initial,
      wrapper: ({ children }: { children: ReactNode }) => (
        <RoundsListStoreProvider store={listStore.store}>
          <RoundProceduresProvider procedures={procedures}>
            {children}
          </RoundProceduresProvider>
        </RoundsListStoreProvider>
      ),
    },
  );
  const attachTail = () =>
    act(() => {
      hook.result.current.tailRef(elements.tail);
    });
  const itemIds = () => {
    const { view } = hook.result.current;
    return view.status === "ok" && view.data.items.map((item) => item.id);
  };
  return {
    ...hook,
    loadList,
    readDeleted,
    procedures,
    intersection,
    elements,
    attachTail,
    itemIds,
  };
}

const settledFirst = (result: { current: { view: { status: string } } }) =>
  waitFor(() => expect(result.current.view.status).not.toBe("loading"));

beforeEach(() => {
  followReplaceState();
  vi.stubGlobal("innerHeight", 800);
});

afterEach(() => {
  fakeSearchParams.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("useHistoryPages", () => {
  describe("先頭のページの取得", () => {
    it("条件を読んだ後に、起点なしで1回取得し、取得できたページを返す", async () => {
      // Given
      const first = page(["a", "b"]);
      const { result, rerender, loadList } = setup(
        { condition: null },
        { loads: [ok(first)] },
      );
      expect(loadList).not.toHaveBeenCalled();
      expect(result.current.view).toEqual({ status: "loading" });

      // When
      rerender({ condition: DEFAULT_HISTORY_CONDITION });

      // Then
      await waitFor(() =>
        expect(result.current.view).toEqual({ status: "ok", data: first }),
      );
      // 画面の高さ800を1件分100で割った2画面分。
      expect(loadList).toHaveBeenCalledExactlyOnceWith(
        DEFAULT_HISTORY_CONDITION,
        null,
        16,
      );
    });

    it.each([
      ["測れない(0)", 0, 10],
      ["1画面に数件しか入らない大きさ", 400, 10],
      ["1画面に何十件も入る小ささ", 4, 50],
    ])(
      "1件分の高さが%sときも、件数は10から50の範囲で渡す",
      (_name, itemHeight, expected) => {
        // Given
        const { loadList } = setup(undefined, { itemHeight });

        // When
        const size = loadList.mock.calls[0]?.[2];

        // Then
        expect(size).toBe(expected);
      },
    );

    it("条件を変えると、表示済みを捨てて取得中にし、新しい条件で先頭から取得し直す", async () => {
      // Given
      const next = Promise.withResolvers<FetchResult<LoadedRoundsList>>();
      const { result, rerender, loadList } = setup(undefined, {
        loads: [ok(page(["a"])), next.promise],
      });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));

      // When
      rerender({ condition: scoreCondition });

      // Then
      expect(result.current.view).toEqual({ status: "loading" });
      expect(loadList).toHaveBeenLastCalledWith(scoreCondition, null, 16);
      const second = page(["b"]);
      await act(async () => next.resolve(ok(second)));
      expect(result.current.view).toEqual({ status: "ok", data: second });
    });

    it("期間と得点の範囲だけを変えた条件でも、表示済みを捨てて、その条件で先頭から取得し直す", async () => {
      // Given
      const { result, rerender, loadList } = setup(undefined, {
        loads: [ok(page(["a"])), ok(page(["b"]))],
      });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));
      const rangeCondition: HistoryCondition = {
        ...DEFAULT_HISTORY_CONDITION,
        dateFrom: "2026-05-01",
        scoreMax: 0,
      };

      // When
      rerender({ condition: rangeCondition });

      // Then
      expect(result.current.view).toEqual({ status: "loading" });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));
      expect(loadList).toHaveBeenLastCalledWith(rangeCondition, null, 16);
    });

    it("値が同じで参照だけが違う条件を渡し直しても、取得し直さず表示を保つ", async () => {
      // Given
      const first = page(["a"]);
      const { result, rerender, loadList } = setup(undefined, {
        loads: [ok(first)],
      });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));

      // When
      rerender({ condition: { ...DEFAULT_HISTORY_CONDITION } });

      // Then
      expect(loadList).toHaveBeenCalledTimes(1);
      expect(result.current.view).toEqual({ status: "ok", data: first });
    });

    it("距離の構成だけを変えた条件でも、表示済みを捨てて、その条件で先頭から取得し直す", async () => {
      // Given
      const { result, rerender, loadList } = setup(undefined, {
        loads: [ok(page(["a"])), ok(page(["b"]))],
      });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));
      const distanceCondition: HistoryCondition = {
        ...DEFAULT_HISTORY_CONDITION,
        distances: [distanceRow(50)],
      };

      // When
      rerender({ condition: distanceCondition });

      // Then
      expect(result.current.view).toEqual({ status: "loading" });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));
      expect(loadList).toHaveBeenLastCalledWith(distanceCondition, null, 16);
    });

    it("距離の構成の中身が同じで配列だけを作り直した条件を渡し直しても、取得し直さず表示を保つ", async () => {
      // Given
      const first = page(["a"]);
      const { result, rerender, loadList } = setup(
        {
          condition: {
            ...DEFAULT_HISTORY_CONDITION,
            distances: [distanceRow(50)],
          },
        },
        { loads: [ok(first)] },
      );
      await waitFor(() => expect(result.current.view.status).toBe("ok"));

      // When
      rerender({
        condition: {
          ...DEFAULT_HISTORY_CONDITION,
          distances: [distanceRow(50)],
        },
      });

      // Then
      expect(loadList).toHaveBeenCalledTimes(1);
      expect(result.current.view).toEqual({ status: "ok", data: first });
    });

    it("距離の構成の行の順序だけが違う条件は、別の条件として取得し直す", async () => {
      // Given
      const { result, rerender, loadList } = setup(
        {
          condition: {
            ...DEFAULT_HISTORY_CONDITION,
            distances: [distanceRow(50), distanceRow(30)],
          },
        },
        { loads: [ok(page(["a"])), ok(page(["b"]))] },
      );
      await waitFor(() => expect(result.current.view.status).toBe("ok"));
      const reversed: HistoryCondition = {
        ...DEFAULT_HISTORY_CONDITION,
        distances: [distanceRow(30), distanceRow(50)],
      };

      // When
      rerender({ condition: reversed });

      // Then
      expect(result.current.view).toEqual({ status: "loading" });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));
      expect(loadList).toHaveBeenLastCalledWith(reversed, null, 16);
    });

    it("遅れて返った、範囲を変える前の条件の結果は捨て、新しい条件の表示に連結しない", async () => {
      // Given
      const stale = Promise.withResolvers<FetchResult<LoadedRoundsList>>();
      const fresh = Promise.withResolvers<FetchResult<LoadedRoundsList>>();
      const { result, rerender, loadList } = setup(undefined, {
        loads: [stale.promise, fresh.promise],
      });
      await waitFor(() => expect(loadList).toHaveBeenCalledTimes(1));
      rerender({
        condition: { ...DEFAULT_HISTORY_CONDITION, scoreMin: 500 },
      });

      // When
      await act(async () => fresh.resolve(ok(page(["new"]))));
      await act(async () => stale.resolve(ok(page(["old"]))));

      // Then
      expect(result.current.view).toEqual({
        status: "ok",
        data: page(["new"]),
      });
    });

    it("遅れて返った前の条件の結果は捨て、新しい条件の表示に連結しない", async () => {
      // Given
      const stale = Promise.withResolvers<FetchResult<LoadedRoundsList>>();
      const fresh = Promise.withResolvers<FetchResult<LoadedRoundsList>>();
      const { result, rerender, loadList } = setup(undefined, {
        loads: [stale.promise, fresh.promise],
      });
      await waitFor(() => expect(loadList).toHaveBeenCalledTimes(1));
      rerender({ condition: scoreCondition });

      // When
      await act(async () => fresh.resolve(ok(page(["new"]))));
      await act(async () => stale.resolve(ok(page(["old"]))));

      // Then
      expect(result.current.view).toEqual({
        status: "ok",
        data: page(["new"]),
      });
    });

    it("取得が拒否されても、取得中のまま固定せずエラーにする", async () => {
      // Given

      // When
      const { result } = setup(undefined, { loads: [new Error("boom")] });
      await waitFor(() => expect(result.current.view.status).toBe("error"));

      // Then
      expect(result.current.view).toEqual({
        status: "error",
        reason: "failed",
      });
    });

    it("再試行すると、表示を取得中にして先頭から取得し直す", async () => {
      // Given
      const { result, loadList } = setup(undefined, {
        loads: [{ status: "error", reason: "failed" }, ok(page(["a"]))],
      });
      await waitFor(() => expect(result.current.view.status).toBe("error"));

      // When
      act(() => result.current.retry());

      // Then
      expect(result.current.view).toEqual({ status: "loading" });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));
      expect(loadList).toHaveBeenCalledTimes(2);
      expect(loadList).toHaveBeenLastCalledWith(
        DEFAULT_HISTORY_CONDITION,
        null,
        16,
      );
    });
  });

  describe("先頭のページがオフライン", () => {
    it("通信が戻ると、取り直して表示する", async () => {
      // Given
      const { result, loadList, procedures } = setup(undefined, {
        offline: true,
        loads: [{ status: "offline" }, ok(page(["a"]))],
      });
      await waitFor(() => expect(result.current.view.status).toBe("offline"));

      // When
      await act(async () => procedures.returnOnline());

      // Then
      await waitFor(() => expect(result.current.view.status).toBe("ok"));
      expect(loadList).toHaveBeenCalledTimes(2);
    });

    it("エラーのときは、通信が戻っても取り直さない", async () => {
      // Given
      const { result, loadList, procedures } = setup(undefined, {
        offline: true,
        loads: [{ status: "error", reason: "failed" }, ok(page(["a"]))],
      });
      await waitFor(() => expect(result.current.view.status).toBe("error"));

      // When
      await act(async () => procedures.returnOnline());

      // Then
      expect(loadList).toHaveBeenCalledTimes(1);
    });
  });

  describe("続きの取得", () => {
    it("末尾が近づくと、前のページの最後のラウンドを起点に1ページだけ取得して連結する", async () => {
      // Given
      const next = Promise.withResolvers<FetchResult<LoadedRoundsList>>();
      const { result, loadList, intersection, attachTail, itemIds } = setup(
        undefined,
        { loads: [ok(page(["a", "b"], { hasMore: true })), next.promise] },
      );
      await waitFor(() => expect(result.current.view.status).toBe("ok"));
      attachTail();

      // When
      act(() => intersection.intersect());
      act(() => intersection.intersect());

      // Then
      expect(result.current.more).toEqual({ status: "loading" });
      expect(loadList).toHaveBeenCalledTimes(2);
      expect(loadList).toHaveBeenLastCalledWith(
        DEFAULT_HISTORY_CONDITION,
        "b",
        16,
      );
      await act(async () => next.resolve(ok(page(["c"]))));
      expect(result.current.more).toEqual({ status: "idle" });
      expect(itemIds()).toEqual(["a", "b", "c"]);
    });

    it("成功した後も末尾が近ければ、続けて取得し、続きがなくなると止まる", async () => {
      // Given
      const { result, loadList, intersection, attachTail } = setup(undefined, {
        loads: [
          ok(page(["a"], { hasMore: true })),
          ok(page(["b"], { hasMore: true })),
          ok(page(["c"])),
        ],
      });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));
      intersection.setNear(true);

      // When
      attachTail();

      // Then
      await waitFor(() => expect(loadList).toHaveBeenCalledTimes(3));
      expect(loadList.mock.calls.map(([, after]) => after)).toEqual([
        null,
        "a",
        "b",
      ]);
      await waitFor(() =>
        expect(result.current.more).toEqual({ status: "idle" }),
      );
      expect(loadList).toHaveBeenCalledTimes(3);
    });

    it("続きがないときは、末尾が近づいても取得しない", async () => {
      // Given
      const { result, loadList, intersection, attachTail } = setup(undefined, {
        loads: [ok(page(["a"]))],
      });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));
      attachTail();

      // When
      act(() => intersection.intersect());

      // Then
      expect(loadList).toHaveBeenCalledTimes(1);
    });

    it("スクロールの入れ物を基準に末尾を監視する", async () => {
      // Given
      const { result, intersection, attachTail, elements } = setup(undefined, {
        loads: [ok(page(["a"], { hasMore: true }))],
      });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));

      // When
      attachTail();

      // Then
      const [observer] = intersection.observers();
      expect(observer?.init?.root).toBe(elements.container);
      expect([...(observer?.targets ?? [])]).toEqual([elements.tail]);
    });

    it.each([
      ["オフライン", { status: "offline" }],
      ["エラー", { status: "error", reason: "failed" }],
    ] as const)(
      "続きの取得が%sで失敗すると、表示済みを残して自動の取得を止める",
      async (_name, failure) => {
        // Given
        const first = page(["a"], { hasMore: true });
        const { result, loadList, intersection, attachTail } = setup(
          undefined,
          { loads: [ok(first), failure] },
        );
        await waitFor(() => expect(result.current.view.status).toBe("ok"));
        attachTail();

        // When
        await act(async () => intersection.intersect());
        act(() => intersection.intersect());

        // Then
        expect(result.current.more).toEqual(failure);
        expect(result.current.view).toEqual({ status: "ok", data: first });
        expect(loadList).toHaveBeenCalledTimes(2);
      },
    );

    it("続きの取得が失敗した後は、通信が戻っても取り直さず、再試行で同じ起点を取り直す", async () => {
      // Given
      const {
        result,
        loadList,
        intersection,
        attachTail,
        procedures,
        itemIds,
      } = setup(undefined, {
        offline: true,
        loads: [
          ok(page(["a"], { hasMore: true })),
          { status: "offline" },
          ok(page(["b"])),
        ],
      });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));
      attachTail();
      await act(async () => intersection.intersect());
      await act(async () => procedures.returnOnline());
      expect(loadList).toHaveBeenCalledTimes(2);

      // When
      await act(async () => result.current.retryMore());

      // Then
      expect(loadList).toHaveBeenCalledTimes(3);
      expect(loadList).toHaveBeenLastCalledWith(
        DEFAULT_HISTORY_CONDITION,
        "a",
        16,
      );
      expect(result.current.more).toEqual({ status: "idle" });
      expect(itemIds()).toEqual(["a", "b"]);
    });

    it("続きの取得が拒否されても、取得中のまま固定せずエラーにする", async () => {
      // Given
      const { result, intersection, attachTail } = setup(undefined, {
        loads: [ok(page(["a"], { hasMore: true })), new Error("boom")],
      });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));
      attachTail();

      // When
      await act(async () => intersection.intersect());

      // Then
      expect(result.current.more).toEqual({
        status: "error",
        reason: "failed",
      });
    });

    it("続きの取得中に条件が変わったら、その結果は捨てる", async () => {
      // Given
      const stale = Promise.withResolvers<FetchResult<LoadedRoundsList>>();
      const { result, rerender, intersection, attachTail, itemIds } = setup(
        undefined,
        {
          loads: [
            ok(page(["a"], { hasMore: true })),
            stale.promise,
            ok(page(["fresh"])),
          ],
        },
      );
      await waitFor(() => expect(result.current.view.status).toBe("ok"));
      attachTail();
      act(() => intersection.intersect());
      rerender({ condition: scoreCondition });
      await waitFor(() => expect(itemIds()).toEqual(["fresh"]));

      // When
      await act(async () => stale.resolve(ok(page(["stale"]))));

      // Then
      expect(itemIds()).toEqual(["fresh"]);
    });
  });

  describe("離れるときの記憶", () => {
    it("先頭のページが成功していれば、連結したページ、削除済みと画面で除いたIDの和、続きの有無と起点、スクロールの位置を書く", async () => {
      // Given
      const { result, unmount, procedures, elements } = setup(
        { condition: DEFAULT_HISTORY_CONDITION, removed: new Set(["removed"]) },
        {
          loads: [
            ok(page(["a", "b"], { hasMore: true, deleted: new Set(["gone"]) })),
          ],
        },
      );
      await waitFor(() => expect(result.current.view.status).toBe("ok"));
      elements.container.scrollTop = 240;

      // When
      unmount();

      // Then
      expect(procedures.historyPagesMemory.read()).toEqual({
        list: page(["a", "b"], {
          hasMore: true,
          deleted: new Set(["gone", "removed"]),
        }),
        scrollTop: 240,
      });
    });

    it("続きの取得中に離れても、取得済みのページだけを書く", async () => {
      // Given
      const first = page(["a"], { hasMore: true });
      const { result, unmount, intersection, attachTail, procedures } = setup(
        undefined,
        { loads: [ok(first)] },
      );
      await waitFor(() => expect(result.current.view.status).toBe("ok"));
      attachTail();
      act(() => intersection.intersect());

      // When
      unmount();

      // Then
      expect(procedures.historyPagesMemory.read()?.list).toEqual(first);
    });

    it("続きの取得が失敗した状態で離れても、取得済みのページだけを書く", async () => {
      // Given
      const first = page(["a"], { hasMore: true });
      const { result, unmount, intersection, attachTail, procedures } = setup(
        undefined,
        { loads: [ok(first), { status: "offline" }] },
      );
      await waitFor(() => expect(result.current.view.status).toBe("ok"));
      attachTail();
      await act(async () => intersection.intersect());

      // When
      unmount();

      // Then
      expect(procedures.historyPagesMemory.read()?.list).toEqual(first);
    });

    it.each([
      ["エラー", { status: "error", reason: "failed" }],
      ["オフライン", { status: "offline" }],
    ] as const)(
      "先頭のページが%sのまま離れると、記憶を消す",
      async (_name, failure) => {
        // Given
        const { result, unmount, procedures } = setup(undefined, {
          offline: true,
          stored: snapshot(page(["stale"])),
          loads: [failure],
        });
        await settledFirst(result);

        // When
        unmount();

        // Then
        expect(procedures.historyPagesMemory.read()).toBeNull();
      },
    );

    it("先頭のページが取得中のまま離れると、記憶を消す", () => {
      // Given
      const { unmount, procedures } = setup(undefined, {
        stored: snapshot(page(["stale"])),
      });

      // When
      unmount();

      // Then
      expect(procedures.historyPagesMemory.read()).toBeNull();
    });

    it("離れた後に返った取得の結果は、記憶に書かない", async () => {
      // Given
      const late = Promise.withResolvers<FetchResult<LoadedRoundsList>>();
      const { unmount, procedures } = setup(undefined, {
        loads: [late.promise],
      });
      unmount();

      // When
      await act(async () => late.resolve(ok(page(["a"]))));

      // Then
      expect(procedures.historyPagesMemory.read()).toBeNull();
    });
  });

  describe("戻りの印", () => {
    it("印のあるURLで開き、記憶があれば、取得せずに記憶を表示し、削除済みのIDを読み直して足す", async () => {
      // Given
      fakeSearchParams.set("?return=1");

      // When
      const { result, loadList, readDeleted } = setup(undefined, {
        stored: snapshot(page(["a", "b"], { deleted: new Set(["d1"]) })),
        deleted: new Set(["d2"]),
      });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));

      // Then
      expect(loadList).not.toHaveBeenCalled();
      expect(readDeleted).toHaveBeenCalledTimes(1);
      expect(result.current.view).toEqual({
        status: "ok",
        data: page(["a", "b"], { deleted: new Set(["d1", "d2"]) }),
      });
      expect(window.history.replaceState).not.toHaveBeenCalled();
    });

    it("記憶したスクロールの位置は、一覧が描かれたときに戻す", async () => {
      // Given
      fakeSearchParams.set("?return=1");
      const { result, elements } = setup(undefined, {
        stored: snapshot(page(["a"]), 300),
      });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));

      // When
      act(() => result.current.restoreScroll());

      // Then
      expect(elements.container.scrollTop).toBe(300);
    });

    it("戻す位置がなければ、スクロールの位置を変えない", async () => {
      // Given
      const { result, elements } = setup(undefined, {
        loads: [ok(page(["a"]))],
      });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));
      elements.container.scrollTop = 50;

      // When
      act(() => result.current.restoreScroll());

      // Then
      expect(elements.container.scrollTop).toBe(50);
    });

    it("印のあるURLで開いても記憶が無ければ、先頭から取得する", async () => {
      // Given
      fakeSearchParams.set("?return=1");

      // When
      const { result, loadList } = setup(undefined, {
        loads: [ok(page(["a"]))],
      });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));

      // Then
      expect(loadList).toHaveBeenCalledExactlyOnceWith(
        DEFAULT_HISTORY_CONDITION,
        null,
        16,
      );
    });

    it("記憶の削除済みの読み直しが失敗したら、記憶を使わず先頭から取得する", async () => {
      // Given
      fakeSearchParams.set("?return=1");

      // When
      const { result, loadList } = setup(undefined, {
        stored: snapshot(page(["stale"])),
        deleted: new Error("boom"),
        loads: [ok(page(["fresh"]))],
      });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));

      // Then
      expect(loadList).toHaveBeenCalledTimes(1);
      expect(result.current.view).toEqual({
        status: "ok",
        data: page(["fresh"]),
      });
    });

    it("印の無いURLで開くと、記憶があっても使わず先頭から取得し、自分のURLに印を付ける", async () => {
      // Given

      // When
      const { result, loadList, readDeleted } = setup(undefined, {
        stored: snapshot(page(["stale"])),
        loads: [ok(page(["fresh"]))],
      });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));

      // Then
      expect(readDeleted).not.toHaveBeenCalled();
      expect(loadList).toHaveBeenCalledTimes(1);
      expect(result.current.view).toEqual({
        status: "ok",
        data: page(["fresh"]),
      });
      // 現在のhistory.stateを渡すと、Next.jsは置き換えを取り込まない。
      expect(window.history.replaceState).toHaveBeenCalledExactlyOnceWith(
        null,
        "",
        RETURN_URL,
      );
    });

    it("表示中に印の無い値へ替わると、表示済みを捨てて先頭から取得し直し、印を付け直す", async () => {
      // Given
      const { result, loadList } = setup(undefined, {
        loads: [ok(page(["a"])), ok(page(["b"]))],
      });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));
      expect(loadList).toHaveBeenCalledTimes(1);

      // When
      // 履歴の項目を押すと、Next.jsは印の無いURLへ検索部を替える。
      act(() => fakeSearchParams.set(""));

      // Then
      await waitFor(() =>
        expect(result.current.view).toEqual({
          status: "ok",
          data: page(["b"]),
        }),
      );
      expect(loadList).toHaveBeenCalledTimes(2);
      expect(window.history.replaceState).toHaveBeenCalledTimes(2);
    });

    it("印の付いた値のままなら、再描画しても取得し直さない", async () => {
      // Given
      const { result, rerender, loadList } = setup(undefined, {
        loads: [ok(page(["a"]))],
      });
      await waitFor(() => expect(result.current.view.status).toBe("ok"));

      // When
      rerender({ condition: DEFAULT_HISTORY_CONDITION });
      act(() => fakeSearchParams.set("?return=1"));

      // Then
      expect(loadList).toHaveBeenCalledTimes(1);
      expect(window.history.replaceState).toHaveBeenCalledTimes(1);
    });
  });
});

function snapshot(list: LoadedRoundsList, scrollTop = 0): HistoryPagesSnapshot {
  return { list, scrollTop };
}
