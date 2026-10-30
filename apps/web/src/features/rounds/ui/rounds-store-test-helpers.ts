import { vi } from "vitest";
import type { RoundsStore } from "../application/rounds-store";

// 画面のテストが使う、偽のラウンドの状態と変更の方法。
// 通信の復帰と待ちの経過の合図を、テストが起こす。契約(whenOnline: 今オンラインなら直ちに1回、オフラインなら次の復帰で1回。afterFallbackWait: 経過で1回。どちらも返す関数で取り消せる)は、実物と同じにする。
export function createFakeRoundsStore(overrides: Partial<RoundsStore> = {}) {
  const state = { offline: false };
  const waitingForOnline = new Set<() => void>();
  const waitingForFallback = new Set<() => void>();
  const cancelled = { online: 0, fallback: 0 };

  const store = {
    load: vi.fn(),
    loadList: vi.fn(),
    loadLocalList: vi.fn(),
    round: vi.fn(),
    append: vi.fn().mockResolvedValue(undefined),
    deleteRound: vi.fn().mockResolvedValue(undefined),
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
    loadPresets: vi.fn(() => new Promise<never>(() => {})),
    deletePreset: vi.fn().mockResolvedValue({ status: "deleted" }),
    startRound: vi
      .fn()
      .mockResolvedValue({ status: "created", roundId: "r-1" }),
    ...overrides,
  } as unknown as RoundsStore & {
    loadList: ReturnType<typeof vi.fn>;
    loadLocalList: ReturnType<typeof vi.fn>;
    deleteRound: ReturnType<typeof vi.fn>;
    whenOnline: ReturnType<typeof vi.fn>;
    afterFallbackWait: ReturnType<typeof vi.fn>;
    loadPresets: ReturnType<typeof vi.fn>;
    deletePreset: ReturnType<typeof vi.fn>;
    startRound: ReturnType<typeof vi.fn>;
  };

  return {
    store,
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
