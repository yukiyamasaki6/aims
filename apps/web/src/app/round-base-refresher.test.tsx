import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSingleFlight, RoundBaseRefresher } from "./round-base-refresher";

// 取得は別のテストで確かめるため、境界としてモックする。
const refresh = vi.hoisted(() => ({ refreshRoundBases: vi.fn() }));
vi.mock("./(main)/rounds/[id]/refresh-round-bases", () => refresh);

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
    // Given: 完了を手で解放する実行
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

    // When: 実行中に3回、契機が来る
    const first = trigger();
    await trigger();
    await trigger();
    await trigger();
    expect(run).toHaveBeenCalledTimes(1);
    releases[0]();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    releases[1]();
    await first;

    // Then
    expect(run).toHaveBeenCalledTimes(2);
    expect(maxRunning).toBe(1);
  });
});

describe("RoundBaseRefresher", () => {
  it("セッションがあるサインインの確認で取得し、成功の回数を出す", async () => {
    render(<RoundBaseRefresher />);
    expect(count()).toBe("0");

    act(() => auth.listener?.("INITIAL_SESSION", { user: { id: "u" } }));

    await waitFor(() => expect(count()).toBe("1"));
  });

  it("セッションが無い確認では取得せず、失敗した取得は回数に数えない", async () => {
    refresh.refreshRoundBases.mockResolvedValue(false);
    render(<RoundBaseRefresher />);

    act(() => auth.listener?.("INITIAL_SESSION", null));
    expect(refresh.refreshRoundBases).not.toHaveBeenCalled();

    act(() => auth.listener?.("SIGNED_IN", { user: { id: "u" } }));
    await waitFor(() => expect(refresh.refreshRoundBases).toHaveBeenCalled());
    expect(count()).toBe("0");
  });

  it("通信の復帰と、画面が見える状態になったときにも取得する", async () => {
    render(<RoundBaseRefresher />);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(count()).toBe("1"));

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(count()).toBe("2"));
  });

  it("画面が隠れるときは取得しない", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<RoundBaseRefresher />);

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(refresh.refreshRoundBases).not.toHaveBeenCalled();
  });

  it("アンマウントの後に取得が終わっても、回数を更新しない", async () => {
    let finish: (value: boolean) => void = () => {};
    refresh.refreshRoundBases.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    );
    const { unmount } = render(<RoundBaseRefresher />);
    act(() => auth.listener?.("SIGNED_IN", { user: { id: "u" } }));
    unmount();

    await act(async () => finish(true));

    expect(refresh.refreshRoundBases).toHaveBeenCalledTimes(1);
  });

  it("アンマウントで購読を解除する", () => {
    const { unmount } = render(<RoundBaseRefresher />);

    unmount();

    expect(auth.unsubscribe).toHaveBeenCalled();
  });
});
