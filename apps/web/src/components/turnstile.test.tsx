import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Turnstile } from "./turnstile";

const { onSuccess, onExpire, onError, siteKeyProp } = vi.hoisted(() => ({
  onSuccess: { current: undefined as ((token: string) => void) | undefined },
  onExpire: { current: undefined as (() => void) | undefined },
  onError: { current: undefined as (() => void) | undefined },
  siteKeyProp: { current: undefined as string | undefined },
}));

vi.mock("@marsidev/react-turnstile", () => ({
  Turnstile: (props: {
    siteKey: string;
    onSuccess?: (token: string) => void;
    onExpire?: () => void;
    onError?: () => void;
  }) => {
    siteKeyProp.current = props.siteKey;
    onSuccess.current = props.onSuccess;
    onExpire.current = props.onExpire;
    onError.current = props.onError;
    return <div data-testid="turnstile" />;
  },
}));

describe("Turnstile", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the underlying widget with the configured site key", () => {
    render(<Turnstile onVerify={vi.fn()} />);

    expect(screen.getByTestId("turnstile")).toBeInTheDocument();
    expect(siteKeyProp.current).toBe("test-site-key");
  });

  it("calls onVerify with the token on success", async () => {
    const handleVerify = vi.fn();
    render(<Turnstile onVerify={handleVerify} />);

    onSuccess.current?.("token-123");

    expect(handleVerify).toHaveBeenCalledWith("token-123");
  });

  it("calls onVerify with null when the challenge expires", () => {
    const handleVerify = vi.fn();
    render(<Turnstile onVerify={handleVerify} />);

    onExpire.current?.();

    expect(handleVerify).toHaveBeenCalledWith(null);
  });

  it("calls onVerify with null on error", () => {
    const handleVerify = vi.fn();
    render(<Turnstile onVerify={handleVerify} />);

    onError.current?.();

    expect(handleVerify).toHaveBeenCalledWith(null);
  });

  it("throws when the site key environment variable is missing", () => {
    vi.unstubAllEnvs();
    expect(() => render(<Turnstile onVerify={vi.fn()} />)).toThrow(
      "Missing NEXT_PUBLIC_TURNSTILE_SITE_KEY environment variable.",
    );
  });
});
