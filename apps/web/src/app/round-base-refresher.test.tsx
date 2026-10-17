import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSingleFlight, RoundBaseRefresher } from "./round-base-refresher";

// 取得は別のテストで確かめるため、境界としてモックする。
const refresh = vi.hoisted(() => ({ refreshRoundBases: vi.fn() }));
vi.mock("@/features/rounds/refresh-round-bases", () => refresh);

const auth = vi.hoisted(() => ({
  listener: undefined as
    | ((event: string, session: unknown) => void)
    | undefined,
  unsubscribe: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (listener: typeof auth.listener) => {
        auth.listener = listener;
        return { data: { subscription: { unsubscribe: auth.unsubscribe } } };
      },
    },
  }),
}));

const count = () =>
  screen
    .getByTestId("round-base-refresher")
    .getAttribute("data-refreshed-count");

beforeEach(() => {
  vi.clearAllMocks();
  refresh.refreshRoundBases.mockResolvedValue(true);
});

describe("createSingleFlight", () => {
  it("実行中の契機は、完了後に1回だけやり直し、同時には実行しない", async () => {
    // Given
    let running = 0;
    let maxRunning = 0;
    const releases: (() => void)[] = [];
    const run = vi.fn(async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise<void>((resolve) => releases.push(resolve));
      running -= 1;
    });
    const trigger = createSingleFlight(run);

    // When
    const first = trigger();
    await trigger();
    await trigger();
    await trigger();
    const callsWhileRunning = run.mock.calls.length;
    releases[0]();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    releases[1]();
    await first;

    // Then
    expect(callsWhileRunning).toBe(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(maxRunning).toBe(1);
  });
});

describe("RoundBaseRefresher", () => {
  it("セッションがあるサインインの確認で取得し、成功の回数を出す", async () => {
    // Given
    render(<RoundBaseRefresher />);
    expect(count()).toBe("0");

    // When
    act(() => auth.listener?.("INITIAL_SESSION", { user: { id: "u" } }));

    // Then
    await waitFor(() => expect(count()).toBe("1"));
  });

  it("セッションが無いサインインの確認では、取得しない", () => {
    // Given
    render(<RoundBaseRefresher />);

    // When
    act(() => auth.listener?.("INITIAL_SESSION", null));

    // Then
    expect(refresh.refreshRoundBases).not.toHaveBeenCalled();
  });

  it("失敗した取得は、成功の回数に数えない", async () => {
    // Given
    refresh.refreshRoundBases.mockResolvedValue(false);
    render(<RoundBaseRefresher />);

    // When
    act(() => auth.listener?.("SIGNED_IN", { user: { id: "u" } }));

    // Then
    await waitFor(() => expect(refresh.refreshRoundBases).toHaveBeenCalled());
    expect(count()).toBe("0");
  });

  it("通信の復帰で取得する", async () => {
    // Given
    render(<RoundBaseRefresher />);

    // When
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    // Then
    await waitFor(() => expect(count()).toBe("1"));
  });

  it("画面が見える状態になったときに取得する", async () => {
    // Given
    render(<RoundBaseRefresher />);

    // When
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Then
    await waitFor(() => expect(count()).toBe("1"));
  });

  it("画面が隠れるときは取得しない", () => {
    // Given
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<RoundBaseRefresher />);

    // When
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Then
    expect(refresh.refreshRoundBases).not.toHaveBeenCalled();
  });

  it("アンマウントの後に取得が終わっても、回数を更新しない", async () => {
    // Given
    let finish: (value: boolean) => void = () => {};
    refresh.refreshRoundBases.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    );
    const { unmount } = render(<RoundBaseRefresher />);
    act(() => auth.listener?.("SIGNED_IN", { user: { id: "u" } }));
    unmount();

    // When
    await act(async () => finish(true));

    // Then
    expect(refresh.refreshRoundBases).toHaveBeenCalledTimes(1);
  });

  it("アンマウントで購読を解除する", () => {
    // Given
    const { unmount } = render(<RoundBaseRefresher />);

    // When
    unmount();

    // Then
    expect(auth.unsubscribe).toHaveBeenCalled();
  });
});
