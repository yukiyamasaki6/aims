import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpSyncProvider } from "./op-sync-provider";

const hub = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  setUser: vi.fn(),
  resumeHeld: vi.fn(),
  handleOnline: vi.fn(),
  getUserId: vi.fn<() => string | null>(),
}));
vi.mock("./(main)/rounds/_shared/round-op-hub", () => ({ roundOpHub: hub }));
vi.mock("@/features/auth/local-identity", () => ({
  getLocalIdentity: () => "user-1",
}));

type AuthListener = (
  event: string,
  session: { user: { id: string } } | null,
) => void;
const auth = vi.hoisted(() => ({
  listener: undefined as AuthListener | undefined,
  unsubscribe: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (listener: AuthListener) => {
        auth.listener = listener;
        return { data: { subscription: { unsubscribe: auth.unsubscribe } } };
      },
    },
  }),
}));

function emit(event: string, userId: string | null) {
  auth.listener?.(event, userId ? { user: { id: userId } } : null);
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.listener = undefined;
  hub.getUserId.mockReturnValue("user-1");
});

describe("OpSyncProvider", () => {
  it("マウントで端末のユーザーを渡して起動し、アンマウントで停止する", () => {
    const { unmount } = render(<OpSyncProvider />);
    expect(hub.start).toHaveBeenCalledWith("user-1");

    unmount();

    expect(hub.stop).toHaveBeenCalledTimes(1);
    expect(auth.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("onlineのイベントをハブへ渡す", () => {
    render(<OpSyncProvider />);

    window.dispatchEvent(new Event("online"));

    expect(hub.handleOnline).toHaveBeenCalledTimes(1);
  });

  it.each(["SIGNED_IN", "INITIAL_SESSION", "TOKEN_REFRESHED"])(
    "%sで同じユーザーなら、保留を戻す",
    (event) => {
      render(<OpSyncProvider />);

      emit(event, "user-1");

      expect(hub.resumeHeld).toHaveBeenCalledTimes(1);
      expect(hub.setUser).not.toHaveBeenCalled();
    },
  );

  it("違うユーザーのセッションなら、ユーザーを替える", () => {
    render(<OpSyncProvider />);

    emit("SIGNED_IN", "user-2");

    expect(hub.setUser).toHaveBeenCalledWith("user-2");
    expect(hub.resumeHeld).not.toHaveBeenCalled();
  });

  it("SIGNED_OUTでユーザーをnullにする", () => {
    render(<OpSyncProvider />);

    emit("SIGNED_OUT", null);

    expect(hub.setUser).toHaveBeenCalledWith(null);
  });

  it("セッションの無いINITIAL_SESSIONでは何もしない", () => {
    render(<OpSyncProvider />);

    emit("INITIAL_SESSION", null);

    expect(hub.setUser).not.toHaveBeenCalled();
    expect(hub.resumeHeld).not.toHaveBeenCalled();
  });
});
