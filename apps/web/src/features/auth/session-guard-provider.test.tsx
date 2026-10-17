import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGuard } from "./session-guard-provider";

const mocks = vi.hoisted(() => ({
  watchSessionLoss: vi.fn(),
  redirectToSignIn: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("./session-guard", () => ({
  watchSessionLoss: mocks.watchSessionLoss,
  redirectToSignIn: mocks.redirectToSignIn,
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.watchSessionLoss.mockReturnValue(mocks.dispose);
});

describe("SessionGuard", () => {
  it("マウントすると、喪失の監視を1回始める", () => {
    // Given
    // When
    render(<SessionGuard />);

    // Then
    expect(mocks.watchSessionLoss).toHaveBeenCalledTimes(1);
  });

  it("監視が喪失を知らせると、/signinへの遷移を呼ぶ", () => {
    // Given
    render(<SessionGuard />);
    const [, options] = mocks.watchSessionLoss.mock.calls[0];

    // When
    options.onLost();

    // Then
    expect(mocks.redirectToSignIn).toHaveBeenCalledTimes(1);
  });

  it("アンマウントすると、監視を解除する", () => {
    // Given
    const { unmount } = render(<SessionGuard />);

    // When
    unmount();

    // Then
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });
});
