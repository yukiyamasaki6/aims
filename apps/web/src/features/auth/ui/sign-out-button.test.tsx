import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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

  it("失敗した後は、ボタンを戻して再度確認でき、再度の確認が始まれば実行中の表示にする", async () => {
    // Given
    const user = userEvent.setup();
    const signOut = vi
      .fn<() => Promise<SignOutResult>>()
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

  describe("他のダイアログの中に置いたとき", () => {
    function renderInDialog() {
      const parentOpenChange = vi.fn();
      render(
        <Dialog open onOpenChange={parentOpenChange}>
          <DialogContent>
            <SignOutButton signOut={vi.fn()} />
          </DialogContent>
        </Dialog>,
        { wrapper: IntlTestProvider },
      );
      return parentOpenChange;
    }

    it("Escで、確認のダイアログだけを閉じ、親のダイアログは開いたままである", async () => {
      // Given
      const user = userEvent.setup();
      const parentOpenChange = renderInDialog();
      await user.click(
        screen.getByRole("button", { name: authText("signOut") }),
      );
      await screen.findByText(authText("signOutConfirm"));

      // When
      await user.keyboard("{Escape}");

      // Then
      await waitFor(() =>
        expect(
          screen.queryByText(authText("signOutConfirm")),
        ).not.toBeInTheDocument(),
      );
      expect(parentOpenChange).not.toHaveBeenCalled();
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    });

    it("確認のダイアログの外側の押下で、確認のダイアログだけを閉じ、親のダイアログは開いたままである", async () => {
      // Given
      const user = userEvent.setup();
      const parentOpenChange = renderInDialog();
      await user.click(
        screen.getByRole("button", { name: authText("signOut") }),
      );
      await screen.findByText(authText("signOutConfirm"));
      const backdrops = document.querySelectorAll(
        '[role="presentation"][data-open]',
      );

      // When
      await user.click(backdrops[backdrops.length - 1]);

      // Then
      await waitFor(() =>
        expect(
          screen.queryByText(authText("signOutConfirm")),
        ).not.toBeInTheDocument(),
      );
      expect(parentOpenChange).not.toHaveBeenCalled();
    });
  });
});
