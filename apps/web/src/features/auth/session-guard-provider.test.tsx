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
  it("マウントで喪失の監視を始め、喪失時に/signinへの遷移を呼び、アンマウントで解除する", () => {
    // Given
    // When
    const { unmount } = render(<SessionGuard />);

    // Then
    expect(mocks.watchSessionLoss).toHaveBeenCalledTimes(1);
    const [, options] = mocks.watchSessionLoss.mock.calls[0];
    options.onLost();
    expect(mocks.redirectToSignIn).toHaveBeenCalledTimes(1);
    unmount();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });
});
