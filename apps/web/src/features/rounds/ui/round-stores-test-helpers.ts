import { vi } from "vitest";
import type { NewRoundStore } from "../application/new-round-store";
import type { RoundDetailStore } from "../application/round-detail-store";
import type { RoundsListStore } from "../application/rounds-list-store";
import type { RoundProcedures } from "./rounds-context";

// 通信の復帰と待ちの経過の合図を、テストが起こす。
// 契約(whenOnline: 今オンラインなら直ちに1回、オフラインなら次の復帰で1回。afterFallbackWait: 経過で1回。whenOnlineは返す関数で取り消せる)は、実物と同じにする。
function createFakeWaiting() {
  const state = { offline: false };
  const waitingForOnline = new Set<() => void>();
  const waitingForFallback = new Set<() => void>();
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
    afterFallbackWait: vi.fn((listener: () => void) => {
      waitingForFallback.add(listener);
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
    // 待ちの経過を起こす。取り消されていないlistenerを呼ぶ。
    elapseFallbackWait() {
      for (const listener of [...waitingForFallback]) {
        waitingForFallback.delete(listener);
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
  const { whenOnline, afterFallbackWait, ...waiting } = createFakeWaiting();
  const store = {
    loadList: vi.fn(),
    loadLocalList: vi.fn(),
    whenOnline,
    afterFallbackWait,
    ...overrides,
  } as unknown as RoundsListStore & {
    loadList: ReturnType<typeof vi.fn>;
    loadLocalList: ReturnType<typeof vi.fn>;
    whenOnline: ReturnType<typeof vi.fn>;
    afterFallbackWait: ReturnType<typeof vi.fn>;
  };
  return { store, ...waiting };
}

// 作成の画面のテストが使う、偽の窓口。
export function createFakeNewRoundStore(
  overrides: Partial<NewRoundStore> = {},
) {
  const {
    whenOnline,
    afterFallbackWait: _afterFallbackWait,
    ...waiting
  } = createFakeWaiting();
  const store = {
    // 既定は永遠に未解決の1個のPromiseを返す。呼び手の無い既定の関数がファイルごとの関数カバレッジ閾値(95%)を割るため、関数ではなく戻り値で指定する。
    loadPresets: vi.fn().mockReturnValue(new Promise<never>(() => {})),
    deletePreset: vi.fn().mockResolvedValue({ status: "deleted" }),
    startRound: vi
      .fn()
      .mockResolvedValue({ status: "created", roundId: "r-1" }),
    whenOnline,
    ...overrides,
  } as unknown as NewRoundStore & {
    loadPresets: ReturnType<typeof vi.fn>;
    deletePreset: ReturnType<typeof vi.fn>;
    startRound: ReturnType<typeof vi.fn>;
    whenOnline: ReturnType<typeof vi.fn>;
  };
  return { store, ...waiting };
}

// 詳細の画面のテストが使う、偽の手続きの入れ物。`RoundProceduresProvider`へ渡す。
export function createFakeRoundProcedures() {
  const issued = { ids: 0 };
  return {
    leaving: {
      completeRound: vi.fn().mockResolvedValue(undefined),
      deleteRoundAndLeave: vi.fn().mockResolvedValue(undefined),
    },
    deletion: {
      deleteRound: vi.fn().mockResolvedValue(undefined),
    },
    presetSaving: {
      savePreset: vi.fn().mockResolvedValue({ status: "saved" }),
    },
    ids: {
      next: vi.fn(() => `id-${++issued.ids}`),
      // 画面は乱数を使わない。呼び手の無い既定の関数が関数カバレッジの閾値を割るため、関数ではなく戻り値で指定する。
      randomBytes: vi.fn().mockReturnValue(new Uint8Array(10)),
    },
  } satisfies RoundProcedures;
}

// 画面のテストが使う、偽のラウンドの状態と変更の方法(詳細の画面の分)。
export function createFakeRoundDetailStore(
  overrides: Partial<RoundDetailStore> = {},
) {
  const {
    whenOnline,
    afterFallbackWait: _afterFallbackWait,
    ...waiting
  } = createFakeWaiting();
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
