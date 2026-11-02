import { vi } from "vitest";
import type { RoundsStore } from "../application/rounds-store";
import { createFakeWaiting } from "./round-stores-test-helpers";

// 画面のテストが使う、偽のラウンドの状態と変更の方法(詳細と作成の画面の分。窓口の分割が済むまでの暫定)。
export function createFakeRoundsStore(overrides: Partial<RoundsStore> = {}) {
  const {
    whenOnline,
    afterFallbackWait: _afterFallbackWait,
    ...waiting
  } = createFakeWaiting();
  const issued = { ids: 0, shots: 0 };

  const store = {
    load: vi.fn(),
    round: vi.fn(),
    append: vi.fn().mockResolvedValue(undefined),
    whenOnline,
    completeRound: vi.fn().mockResolvedValue(undefined),
    deleteRoundAndLeave: vi.fn().mockResolvedValue(undefined),
    leaveRound: vi.fn(),
    savePreset: vi.fn().mockResolvedValue({ status: "saved" }),
    newId: vi.fn(() => `id-${++issued.ids}`),
    newShotId: vi.fn(
      () =>
        `00000000-0000-7000-8000-${String(++issued.shots).padStart(12, "0")}`,
    ),
    ...overrides,
  } as unknown as RoundsStore & {
    whenOnline: ReturnType<typeof vi.fn>;
    completeRound: ReturnType<typeof vi.fn>;
    deleteRoundAndLeave: ReturnType<typeof vi.fn>;
    leaveRound: ReturnType<typeof vi.fn>;
    savePreset: ReturnType<typeof vi.fn>;
    newId: ReturnType<typeof vi.fn>;
    newShotId: ReturnType<typeof vi.fn>;
  };

  return { store, ...waiting };
}
