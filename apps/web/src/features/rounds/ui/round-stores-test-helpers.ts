import { vi } from "vitest";
import type { RoundDetailStore } from "../application/round-detail-store";
import type { RoundsListStore } from "../application/rounds-list-store";
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
    loadLocalList: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    ...overrides,
  } as unknown as RoundsListStore & {
    loadList: ReturnType<typeof vi.fn>;
    loadLocalList: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  };
  return { store };
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
    },
    ids: {
      next: vi.fn(() => `id-${++issued.ids}`),
      // 画面は乱数を使わない。呼び手の無い既定の関数が関数カバレッジの閾値を割るため、関数ではなく戻り値で指定する。
      randomBytes: vi.fn().mockReturnValue(new Uint8Array(10)),
    },
    whenOnline,
    ...waiting,
  } satisfies RoundProcedures;
}

// 画面のテストが使う、偽のラウンドの状態と変更の方法(詳細の画面の分)。
export function createFakeRoundDetailStore(
  overrides: Partial<RoundDetailStore> = {},
) {
  const { whenOnline, ...waiting } = createFakeWaiting();
  const issued = { shots: 0 };

  const store = {
    load: vi.fn(),
    round: vi.fn(),
    append: vi.fn().mockResolvedValue(undefined),
    whenOnline,
    newShotId: vi.fn(
      () =>
        `00000000-0000-7000-8000-${String(++issued.shots).padStart(12, "0")}`,
    ),
    ...overrides,
  } as unknown as RoundDetailStore & {
    whenOnline: ReturnType<typeof vi.fn>;
    newShotId: ReturnType<typeof vi.fn>;
  };

  return { store, ...waiting };
}
