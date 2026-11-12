import { vi } from "vitest";
import { createFakeHistoryViewMemory } from "../application/fake-history-view-memory-test-helpers";
import { createHistoryPagesMemory } from "../application/history-pages-memory";
import type { RoundScreen, RoundWindow } from "../application/round-window";
import type { RoundsListStore } from "../application/rounds-list-store";
import type { FetchView } from "../domain/fetch-status";
import type { LocalRoundsList } from "../domain/round-list";
import type { RoundState } from "../domain/round-tables";
import type { RoundProcedures } from "./rounds-context";

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
  const issued = { ids: 0, shots: 0 };
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
    },
    ids: {
      next: vi.fn(() => `id-${++issued.ids}`),
      // 画面は乱数を使わない。呼び手の無い既定の関数が関数カバレッジの閾値を割るため、関数ではなく戻り値で指定する。
      randomBytes: vi.fn().mockReturnValue(new Uint8Array(10)),
    },
    whenOnline,
    historyViewMemory: createFakeHistoryViewMemory().memory,
    historyPagesMemory: createHistoryPagesMemory(),
    newShotId: vi.fn(
      () =>
        `00000000-0000-7000-8000-${String(++issued.shots).padStart(12, "0")}`,
    ),
    ...waiting,
  } satisfies RoundProcedures;
}
