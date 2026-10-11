import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoundOpSync } from "../_shared/round-op-log";
import { startBaseRefetch } from "./base-refetch";
import { type LoadedRound, loadRoundDetail } from "./load-round-detail";

vi.mock("./load-round-detail", () => ({ loadRoundDetail: vi.fn() }));
vi.mock("@/features/op-log/sync-result", () => ({ retryDelayMs: () => 10 }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn(() => ({})) }));

const reload = vi.mocked(loadRoundDetail);

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
}

function setup({
  stale = true,
  pendingServer,
}: {
  stale?: boolean;
  pendingServer?: LoadedRound["pendingServer"];
} = {}) {
  const sync = {
    wake: vi.fn(),
    subscribeDiverged: vi.fn(() => vi.fn()),
  } as unknown as RoundOpSync;
  const env = {
    roundId: "round-1",
    sync,
    stale: { current: stale },
    onGone: vi.fn(),
    pendingServer,
    requestRefetch: { current: () => {} },
  };
  return { env, stop: startBaseRefetch(env) };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: true,
  });
  setVisibility("visible");
  reload.mockResolvedValue({ status: "offline" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startBaseRefetch", () => {
  describe("後片付けの後", () => {
    it("取り直しの要求は何も取得しない", async () => {
      // Given: 開始して後片付けを済ませた
      const { env, stop } = setup();
      stop();

      // When
      env.requestRefetch.current();
      await Promise.resolve();

      // Then
      expect(reload).not.toHaveBeenCalled();
    });

    it("後片付けの後に届いた取得済みの結果で、onGoneを呼ばない", async () => {
      // Given: 結果が後片付けの後に届く
      let resolve: (value: { status: "not-found" }) => void = () => {};
      const pendingServer = new Promise<{ status: "not-found" }>((r) => {
        resolve = r;
      });
      const { env, stop } = setup({
        pendingServer: pendingServer as LoadedRound["pendingServer"],
      });
      stop();

      // When
      resolve({ status: "not-found" });
      await pendingServer;

      // Then
      expect(env.onGone).not.toHaveBeenCalled();
    });
  });

  describe("visibilitychange", () => {
    it("表示されたときは取り直し、隠れたときは取り直さない", async () => {
      // Given
      const { stop } = setup();
      reload.mockClear();

      // When: 隠れる
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();

      // Then
      expect(reload).not.toHaveBeenCalled();

      // When: 表示される
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));

      // Then
      expect(reload).toHaveBeenCalledTimes(1);
      stop();
    });
  });
});
