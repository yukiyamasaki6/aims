import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import type { SignOutResult } from "../application/session";
import { UNREACHABLE } from "../domain/auth-failure";
import { SignOutButton } from "./sign-out-button";

const authText = translatorFor("auth");
const sharedText = translatorFor("shared");

async function confirmSignOut(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: authText("signOut") }));
  await user.click(screen.getByTestId("confirm-dialog-confirm"));
}

const NETWORK_ERROR_MESSAGE = authText("failure.unreachable");

describe("SignOutButton", () => {
  it("サインアウトのボタンを表示する", () => {
    // Given
    const signOut = vi.fn();

    // When
    render(<SignOutButton signOut={signOut} />, { wrapper: IntlTestProvider });

    // Then
    expect(
      screen.getByRole("button", { name: authText("signOut") }),
    ).toBeInTheDocument();
  });

  it("ボタンを押すと、サインアウトの確認ダイアログを表示し、まだ実行しない", async () => {
    // Given
    const user = userEvent.setup();
    const signOut = vi.fn();
    render(<SignOutButton signOut={signOut} />, { wrapper: IntlTestProvider });

    // When
    await user.click(screen.getByRole("button", { name: authText("signOut") }));

    // Then
    expect(
      await screen.findByText(authText("signOutConfirm")),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: authText("signOutConfirmLabel") }),
    ).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("完了しても、実行中の表示のまま何も変えない(遷移で画面ごと捨てられる)", async () => {
    // Given
    const user = userEvent.setup();
    const signOut = vi.fn(
      async (): Promise<SignOutResult> => ({ kind: "ignored" }),
    );
    render(<SignOutButton signOut={signOut} />, { wrapper: IntlTestProvider });

    // When
    await confirmSignOut(user);

    // Then
    expect(screen.getByText(authText("signOutConfirm"))).toBeInTheDocument();
    expect(screen.getByTestId("confirm-dialog-confirm")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("失敗した場合は、理由を表示してダイアログを開いたままにし、再度確認できる", async () => {
    // Given
    const user = userEvent.setup();
    const signOut = vi.fn(
      async (): Promise<SignOutResult> => ({
        kind: "failed",
        failure: { kind: "rate_limited" },
      }),
    );
    render(<SignOutButton signOut={signOut} />, { wrapper: IntlTestProvider });

    // When
    await confirmSignOut(user);

    // Then
    expect(
      await screen.findByText(authText("failure.rate_limited")),
    ).toBeInTheDocument();
    expect(screen.getByText(authText("signOutConfirm"))).toBeInTheDocument();
    expect(screen.getByTestId("confirm-dialog-confirm")).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });

  it("その他の失敗は、固定の文言を表示する", async () => {
    // Given
    const user = userEvent.setup();
    const signOut = vi.fn(
      async (): Promise<SignOutResult> => ({
        kind: "failed",
        failure: { kind: "other" },
      }),
    );
    render(<SignOutButton signOut={signOut} />, { wrapper: IntlTestProvider });

    // When
    await confirmSignOut(user);

    // Then
    expect(
      await screen.findByText(authText("failure.other")),
    ).toBeInTheDocument();
  });

  it("実行を頼むとき、画面が表示中かを渡し、離れた後は偽になる", async () => {
    // Given
    const user = userEvent.setup();
    let view: { isMounted(): boolean } | undefined;
    let finish: (result: SignOutResult) => void = () => {};
    const signOut = vi.fn((v: { isMounted(): boolean }) => {
      view = v;
      return new Promise<SignOutResult>((resolve) => {
        finish = resolve;
      });
    });
    const { unmount } = render(<SignOutButton signOut={signOut} />, {
      wrapper: IntlTestProvider,
    });
    await confirmSignOut(user);
    expect(view?.isMounted()).toBe(true);

    // When
    unmount();

    // Then
    expect(view?.isMounted()).toBe(false);
    await act(async () => finish({ kind: "ignored" }));
  });

  it("失敗した後は、ボタンを戻して再度確認でき、再度の確認が始まれば実行中の表示にする", async () => {
    // Given
    const user = userEvent.setup();
    const signOut = vi
      .fn<(view: { isMounted(): boolean }) => Promise<SignOutResult>>()
      .mockResolvedValueOnce({ kind: "failed", failure: UNREACHABLE })
      .mockImplementationOnce(() => new Promise<SignOutResult>(() => {}));
    render(<SignOutButton signOut={signOut} />, { wrapper: IntlTestProvider });
    await confirmSignOut(user);
    await screen.findByText(NETWORK_ERROR_MESSAGE);
    const confirm = screen.getByTestId("confirm-dialog-confirm");
    await waitFor(() =>
      expect(confirm).toHaveAttribute("aria-disabled", "false"),
    );

    // When
    await user.click(confirm);

    // Then
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText(NETWORK_ERROR_MESSAGE)).not.toBeInTheDocument();
    expect(signOut).toHaveBeenCalledTimes(2);
  });

  it("失敗の表示中にダイアログを閉じると、エラーを消す", async () => {
    // Given
    const user = userEvent.setup();
    const signOut = vi.fn(
      async (): Promise<SignOutResult> => ({
        kind: "failed",
        failure: UNREACHABLE,
      }),
    );
    render(<SignOutButton signOut={signOut} />, { wrapper: IntlTestProvider });
    await confirmSignOut(user);
    await screen.findByText(NETWORK_ERROR_MESSAGE);

    // When
    await user.click(
      screen.getByRole("button", { name: sharedText("confirmCancel") }),
    );
    await user.click(screen.getByRole("button", { name: authText("signOut") }));

    // Then
    expect(screen.getByText(authText("signOutConfirm"))).toBeInTheDocument();
    expect(screen.queryByText(NETWORK_ERROR_MESSAGE)).not.toBeInTheDocument();
  });
});
