import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeleteAccount } from "@/features/auth/application/delete-account";
import { DeleteAccountProvider } from "@/features/auth/ui/delete-account-context";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import DeleteAccountPage from "./page";

const authText = translatorFor("auth");

const widget = vi.hoisted(() => ({
  onVerify: undefined as ((token: string | null) => void) | undefined,
  siteKey: undefined as string | undefined,
}));

// セキュリティチェックは外部のウィジェットのため、トークンを発行できる代役に差し替える。
vi.mock("@/features/auth/ui/turnstile", () => ({
  Turnstile: forwardRef<
    unknown,
    { siteKey: string; onVerify: (token: string | null) => void }
  >(function TurnstileStub({ siteKey, onVerify }, ref) {
    widget.onVerify = onVerify;
    widget.siteKey = siteKey;
    useImperativeHandle(ref, () => ({ reset: () => {} }));
    return null;
  }),
}));

function renderPage(deleteAccount: DeleteAccount) {
  return render(
    <DeleteAccountProvider deleteAccount={deleteAccount}>
      <DeleteAccountPage />
    </DeleteAccountProvider>,
    { wrapper: IntlTestProvider },
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("アカウント削除画面の入口", () => {
  it("アカウント削除の画面を、入力が空の初期の状態で表示する", () => {
    // Given
    const deleteAccount: DeleteAccount = { submit: vi.fn() };

    // When
    renderPage(deleteAccount);

    // Then
    expect(
      screen.getByRole("heading", { name: authText("deleteAccountTitle") }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(authText("deleteAccountPasswordPlaceholder")),
    ).toHaveValue("");
  });

  it("入口が受け取った手続きに、入力したパスワードで削除を頼む", async () => {
    // Given
    const deleteAccount: DeleteAccount = { submit: vi.fn(async () => {}) };
    const user = userEvent.setup();
    renderPage(deleteAccount);
    await user.type(
      screen.getByPlaceholderText(authText("deleteAccountPasswordPlaceholder")),
      "password-current1",
    );
    act(() => widget.onVerify?.("captcha-token"));

    // When
    await user.click(
      screen.getByRole("button", { name: authText("deleteAccountSubmit") }),
    );

    // Then
    expect(deleteAccount.submit).toHaveBeenCalledOnce();
    expect(vi.mocked(deleteAccount.submit).mock.calls[0][0]).toEqual({
      password: "password-current1",
    });
  });

  it("セキュリティチェックのサイトキーの環境変数を、チェックへ渡す。無ければ空にして、例外を投げずに描画する", () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key-1");
    const deleteAccount: DeleteAccount = { submit: vi.fn() };
    const withKey = renderPage(deleteAccount);
    const keyed = widget.siteKey;
    withKey.unmount();
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", undefined);

    // When
    renderPage(deleteAccount);

    // Then
    expect(keyed).toBe("site-key-1");
    expect(widget.siteKey).toBe("");
  });

  it("手続きの提供が無いと、投げる", () => {
    // Given
    vi.spyOn(console, "error").mockImplementation(() => {});

    // When
    const renderWithout = () =>
      render(<DeleteAccountPage />, { wrapper: IntlTestProvider });

    // Then
    expect(renderWithout).toThrow();
  });
});
