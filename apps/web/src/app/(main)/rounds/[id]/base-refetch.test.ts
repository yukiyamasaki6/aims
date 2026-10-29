import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import type { RoundOpSync } from "@/features/rounds/round-op-log";
import { startBaseRefetch } from "./base-refetch";
import { type LoadedRound, loadRoundDetail } from "./load-round-detail";

vi.mock("./load-round-detail", () => ({ loadRoundDetail: vi.fn() }));
vi.mock("@/features/op-log/sync-result", () => ({ retryDelayMs: () => 10 }));
vi.mock("@/lib/supabase/infrastructure/client", () => ({
  createClient: vi.fn(() => ({})),
}));

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
    sessionReader: { readSession: vi.fn() },
    identityReader: { read: vi.fn() },
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
      // Given
      const { env, stop } = setup();
      stop();

      // When
      env.requestRefetch.current();
      await Promise.resolve();

      // Then
      expect(reload).not.toHaveBeenCalled();
    });

    it("後片付けの後に届いた取得済みの結果で、onGoneを呼ばない", async () => {
      // Given
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
      onTestFinished(stop);
      reload.mockClear();

      // When
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      const callsWhileHidden = reload.mock.calls.length;
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));

      // Then
      expect(callsWhileHidden).toBe(0);
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});
