import type { ComponentProps } from "react";
import { vi } from "vitest";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { createFakeHistoryViewMemory } from "../application/fake-history-view-memory-test-helpers";
import { createHistoryPagesMemory } from "../application/history-pages-memory";
import type { RoundScreen, RoundWindow } from "../application/round-window";
import type { RoundsListStore } from "../application/rounds-list-store";
import type { FetchView } from "../domain/fetch-status";
import { BOW_TYPE_OPTIONS, FORMAT_OPTIONS } from "../domain/round-constants";
import type {
  DistanceListItem,
  LocalRoundsList,
  RoundListItem,
} from "../domain/round-list";
import type { RoundState } from "../domain/round-tables";
import type { RoundProceduresProvider } from "./rounds-context";

const roundsText = translatorFor("rounds");

// 通信の復帰の合図を、テストが起こす。
// 契約(whenOnline: 今オンラインなら直ちに1回、オフラインなら次の復帰で1回。返す関数で取り消せる)は、実物と同じにする。
function createFakeWaiting() {
  const state = { offline: false };
  const waitingForOnline = new Set<() => void>();
  const cancelled = { online: 0 };

  return {
    whenOnline: vi.fn((listener: () => void) => {
      if (!state.offline) {
        listener();
        return vi.fn();
      }
      waitingForOnline.add(listener);
      return () => {
        if (waitingForOnline.delete(listener)) cancelled.online += 1;
      };
    }),
    // 以降のwhenOnlineを、オフラインの扱い(復帰まで呼ばない)にする。
    goOffline() {
      state.offline = true;
    },
    // 通信が戻る。待っているlistenerを1回ずつ呼ぶ。
    returnOnline() {
      state.offline = false;
      for (const listener of [...waitingForOnline]) {
        waitingForOnline.delete(listener);
        listener();
      }
    },
    // 取り消された数。
    online: { cancelled: () => cancelled.online },
  };
}

// 一覧の画面のテストが使う、偽の窓口。
export function createFakeRoundsListStore(
  overrides: Partial<RoundsListStore> = {},
) {
  const store = {
    loadList: vi.fn(),
    readDeleted: vi.fn().mockResolvedValue(new Set<string>()),
    ...overrides,
  } as unknown as RoundsListStore & {
    loadList: ReturnType<typeof vi.fn>;
    readDeleted: ReturnType<typeof vi.fn>;
  };
  return { store };
}

// 画面のテストが使う、偽の窓口。詳細の画面の状態と端末内の入力中一覧を、テストが設定して通知する。
export function createFakeRoundWindow() {
  let local: LocalRoundsList | null = null;
  const localListeners = new Set<() => void>();
  const views = new Map<string, FetchView<RoundScreen>>();
  const listeners = new Map<string, Set<() => void>>();
  const loading: FetchView<RoundScreen> = { status: "loading" };
  const roundWindow = {
    watch: vi.fn((roundId: string, listener: () => void) => {
      const set = listeners.get(roundId) ?? new Set();
      set.add(listener);
      listeners.set(roundId, set);
      return () => {
        set.delete(listener);
      };
    }),
    view: vi.fn((roundId: string) => views.get(roundId) ?? loading),
    retry: vi.fn(),
    append: vi.fn(),
    watchLocalList: vi.fn((listener: () => void) => {
      localListeners.add(listener);
      return () => {
        localListeners.delete(listener);
      };
    }),
    localList: vi.fn(() => local),
  } as unknown as RoundWindow & {
    watch: ReturnType<typeof vi.fn>;
    view: ReturnType<typeof vi.fn>;
    retry: ReturnType<typeof vi.fn>;
    append: ReturnType<
      typeof vi.fn<(roundId: string, op: unknown) => RoundState>
    >;
    watchLocalList: ReturnType<typeof vi.fn>;
    localList: ReturnType<typeof vi.fn>;
  };
  return {
    roundWindow,
    // 端末内の一覧を設定し、購読者へ知らせる。
    setLocal(next: LocalRoundsList | null) {
      local = next;
      for (const listener of [...localListeners]) listener();
    },
    // 詳細の画面の状態を設定し、購読者へ知らせる。
    setView(roundId: string, next: FetchView<RoundScreen>) {
      views.set(roundId, next);
      for (const listener of [...(listeners.get(roundId) ?? [])]) listener();
    },
  };
}

// 詳細の画面のテストが使う、偽の手続きの入れ物。`RoundProceduresProvider`へ渡す。
export function createFakeRoundProcedures() {
  const issued = { ids: 0 };
  const { whenOnline, ...waiting } = createFakeWaiting();
  return {
    leaving: {
      completeRound: vi.fn().mockResolvedValue(undefined),
      deleteRoundAndLeave: vi.fn().mockResolvedValue(undefined),
    },
    deletion: {
      deleteRound: vi.fn().mockResolvedValue(undefined),
    },
    roundStart: {
      startRound: vi
        .fn()
        .mockResolvedValue({ status: "created", roundId: "r-1" }),
    },
    presetSaving: {
      savePreset: vi.fn().mockResolvedValue({ status: "saved" }),
    },
    presetDeletion: {
      deletePreset: vi.fn().mockResolvedValue({ status: "deleted" }),
    },
    fetching: {
      // 既定は永遠に未解決の1個のPromiseを返す。呼び手の無い既定の関数がファイルごとの関数カバレッジ閾値(95%)を割るため、関数ではなく戻り値で指定する。
      fetchPresets: vi.fn().mockReturnValue(new Promise<never>(() => {})),
      savedPresets: vi.fn().mockReturnValue(null),
      savedTargetFaces: vi.fn().mockReturnValue(null),
    },
    ids: {
      next: vi.fn(() => `id-${++issued.ids}`),
    },
    recordUserId: vi.fn(() => "user-1"),
    whenOnline,
    historyViewMemory: createFakeHistoryViewMemory().memory,
    historyPagesMemory: createHistoryPagesMemory(),
    ...waiting,
  } satisfies ComponentProps<typeof RoundProceduresProvider>["procedures"];
}

// 一覧のラウンド単位の1件。既定は屋外・リカーブで、距離が1つ(合計点と同じ小計)。
export function roundListItem(
  overrides: Partial<RoundListItem> = {},
): RoundListItem {
  const total = overrides.total ?? 0;
  return {
    id: "round-1",
    name: "午前練習",
    roundDate: "2026-09-15",
    format: "outdoor",
    bowType: "recurve",
    total,
    distances: [{ distance: 70, isMarked: true, total }],
    ...overrides,
  };
}

// 一覧の距離単位の1件。既定は屋外・リカーブの1/1番目の距離。
export function distanceListItem(
  overrides: Partial<DistanceListItem> = {},
): DistanceListItem {
  return {
    id: "d-1",
    roundId: "round-1",
    name: "午前練習",
    roundDate: "2026-09-15",
    format: "outdoor",
    bowType: "recurve",
    distance: 50,
    isMarked: true,
    total: 300,
    ...overrides,
  };
}

// jsdomは幅を測れないため、カードの寸法を寸法のスタブで与える。呼び出し側は、テストの後に`vi.restoreAllMocks()`で戻す。
// 既定の幅(2000)では全ての要素が入る。文字の幅は、日付70・ラウンド名の最小56・種別40・弓種50(測定の誤差の切り上げと1pxを含む)になる。
export const WIDE_CARD_WIDTH = 2000;

const TEXT_WIDTHS = new Map<string, number>([
  ["0000/00/00", 69],
  [String.fromCodePoint(0x3042, 0x3044, 0x3046, 0x3048), 55],
  ...FORMAT_OPTIONS.map(
    (value) => [roundsText(`formatOption.${value}`), 39] as const,
  ),
  ...BOW_TYPE_OPTIONS.map(
    (value) => [roundsText(`bowTypeOption.${value}`), 49] as const,
  ),
]);

// スタブを重ねて置いても元の関数を呼べるよう、置く前に控える。
const computedStyleOf = window.getComputedStyle.bind(window);

export function stubCardLayout(available = WIDE_CARD_WIDTH) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return this instanceof HTMLAnchorElement ? available : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return { width: TEXT_WIDTHS.get(this.textContent ?? "") ?? 0 } as DOMRect;
    },
  );
  // カードの左右の余白は、スタイルシートを読まないjsdomでは決まらないため、0にする。
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const style = computedStyleOf(element, pseudo);
    if (!(element instanceof HTMLAnchorElement)) return style;
    return new Proxy(style, {
      get(target, key) {
        if (key === "paddingLeft" || key === "paddingRight") return "0px";
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });
}
