import { render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LinkGoogle } from "../application/link-google";
import { LinkGoogleProvider, useLinkGoogle } from "./link-google-context";

function createLinkGoogle(): LinkGoogle {
  return {
    stored: vi.fn(),
    start: vi.fn(),
    capture: vi.fn(),
    resume: vi.fn(),
    remove: vi.fn(),
  };
}

describe("LinkGoogleProvider", () => {
  it("提供したGoogle認証の手続きを、子孫のuseLinkGoogleが返す", () => {
    // Given
    const linkGoogle = createLinkGoogle();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LinkGoogleProvider linkGoogle={linkGoogle}>
        {children}
      </LinkGoogleProvider>
    );

    // When
    const { result } = renderHook(() => useLinkGoogle(), { wrapper });

    // Then
    expect(result.current).toBe(linkGoogle);
  });

  it("子要素を描画する", () => {
    // Given
    const linkGoogle = createLinkGoogle();

    // When
    const { getByText } = render(
      <LinkGoogleProvider linkGoogle={linkGoogle}>
        <p>子要素</p>
      </LinkGoogleProvider>,
    );

    // Then
    expect(getByText("子要素")).toBeInTheDocument();
  });

  it("提供が無いとき、useLinkGoogleは投げる", () => {
    // Given
    vi.spyOn(console, "error").mockImplementation(() => {});

    // When
    const render = () => renderHook(() => useLinkGoogle());

    // Then
    expect(render).toThrow();
  });
});
