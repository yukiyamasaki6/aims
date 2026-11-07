import { render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "../application/session";
import { SessionProvider, useSession } from "./session-context";

describe("SessionProvider", () => {
  it("提供したセッションの手続きを、子孫のuseSessionが返す", () => {
    // Given
    const session: Session = { signOut: vi.fn(), watch: vi.fn() };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider session={session}>{children}</SessionProvider>
    );

    // When
    const { result } = renderHook(() => useSession(), { wrapper });

    // Then
    expect(result.current).toBe(session);
  });

  it("子要素を描画する", () => {
    // Given
    const session: Session = { signOut: vi.fn(), watch: vi.fn() };

    // When
    const { getByText } = render(
      <SessionProvider session={session}>
        <p>子要素</p>
      </SessionProvider>,
    );

    // Then
    expect(getByText("子要素")).toBeInTheDocument();
  });

  it("提供が無いとき、useSessionは投げる", () => {
    // Given
    vi.spyOn(console, "error").mockImplementation(() => {});

    // When
    const call = () => renderHook(() => useSession());

    // Then
    expect(call).toThrow("SessionProvider がありません。");
  });
});
