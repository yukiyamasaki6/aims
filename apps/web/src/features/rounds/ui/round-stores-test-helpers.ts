import { vi } from "vitest";
import type { NewRoundStore } from "../application/new-round-store";
import type { RoundsListStore } from "../application/rounds-list-store";

// 通信の復帰と待ちの経過の合図を、テストが起こす。
// 契約(whenOnline: 今オンラインなら直ちに1回、オフラインなら次の復帰で1回。afterFallbackWait: 経過で1回。どちらも返す関数で取り消せる)は、実物と同じにする。
export function createFakeWaiting() {
  const state = { offline: false };
  const waitingForOnline = new Set<() => void>();
  const waitingForFallback = new Set<() => void>();
  const cancelled = { online: 0, fallback: 0 };

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
      return () => {
        if (waitingForFallback.delete(listener)) cancelled.fallback += 1;
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
    // 待ちの経過を起こす。取り消されていないlistenerを呼ぶ。
    elapseFallbackWait() {
      for (const listener of [...waitingForFallback]) {
        waitingForFallback.delete(listener);
        listener();
      }
    },
    // 取り消された数。
    online: { cancelled: () => cancelled.online },
    fallback: { cancelled: () => cancelled.fallback },
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
    deleteRound: vi.fn().mockResolvedValue(undefined),
    whenOnline,
    afterFallbackWait,
    ...overrides,
  } as unknown as RoundsListStore & {
    loadList: ReturnType<typeof vi.fn>;
    loadLocalList: ReturnType<typeof vi.fn>;
    deleteRound: ReturnType<typeof vi.fn>;
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
