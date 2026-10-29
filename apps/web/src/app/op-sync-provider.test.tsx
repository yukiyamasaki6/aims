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
vi.mock("@/features/rounds/round-op-hub", () => ({ roundOpHub: hub }));

const identityReader = { read: () => "user-1" };
const sessionReader = { readSession: vi.fn() };

type AuthListener = (
  event: string,
  session: { user: { id: string } } | null,
) => void;
const auth = vi.hoisted(() => ({
  listener: undefined as AuthListener | undefined,
  unsubscribe: vi.fn(),
}));
vi.mock("@/lib/supabase/infrastructure/client", () => ({
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
  it("マウントで、端末のユーザーを渡してハブを起動する", () => {
    // Given
    // When
    render(
      <OpSyncProvider
        identityReader={identityReader}
        sessionReader={sessionReader}
      />,
    );

    // Then
    expect(hub.start).toHaveBeenCalledWith("user-1", sessionReader);
  });

  it("アンマウントで、ハブを停止し、認証イベントの購読を解除する", () => {
    // Given
    const { unmount } = render(
      <OpSyncProvider
        identityReader={identityReader}
        sessionReader={sessionReader}
      />,
    );

    // When
    unmount();

    // Then
    expect(hub.stop).toHaveBeenCalledTimes(1);
    expect(auth.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("onlineのイベントをハブへ渡す", () => {
    // Given
    render(
      <OpSyncProvider
        identityReader={identityReader}
        sessionReader={sessionReader}
      />,
    );

    // When
    window.dispatchEvent(new Event("online"));

    // Then
    expect(hub.handleOnline).toHaveBeenCalledTimes(1);
  });

  it.each(["SIGNED_IN", "INITIAL_SESSION", "TOKEN_REFRESHED"])(
    "%sで同じユーザーなら、保留を戻す",
    (event) => {
      // Given
      render(
        <OpSyncProvider
          identityReader={identityReader}
          sessionReader={sessionReader}
        />,
      );

      // When
      emit(event, "user-1");

      // Then
      expect(hub.resumeHeld).toHaveBeenCalledTimes(1);
      expect(hub.setUser).not.toHaveBeenCalled();
    },
  );

  it("違うユーザーのセッションなら、ユーザーを替える", () => {
    // Given
    render(
      <OpSyncProvider
        identityReader={identityReader}
        sessionReader={sessionReader}
      />,
    );

    // When
    emit("SIGNED_IN", "user-2");

    // Then
    expect(hub.setUser).toHaveBeenCalledWith("user-2");
    expect(hub.resumeHeld).not.toHaveBeenCalled();
  });

  it("SIGNED_OUTでユーザーをnullにする", () => {
    // Given
    render(
      <OpSyncProvider
        identityReader={identityReader}
        sessionReader={sessionReader}
      />,
    );

    // When
    emit("SIGNED_OUT", null);

    // Then
    expect(hub.setUser).toHaveBeenCalledWith(null);
  });

  it("セッションの無いINITIAL_SESSIONでは何もしない", () => {
    // Given
    render(
      <OpSyncProvider
        identityReader={identityReader}
        sessionReader={sessionReader}
      />,
    );

    // When
    emit("INITIAL_SESSION", null);

    // Then
    expect(hub.setUser).not.toHaveBeenCalled();
    expect(hub.resumeHeld).not.toHaveBeenCalled();
  });
});
