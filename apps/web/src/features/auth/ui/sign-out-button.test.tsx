import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CallResult } from "../application/call-result";
import { createSession, type SignOutResult } from "../application/session";
import { NETWORK_ERROR_MESSAGE, UNREACHABLE } from "../domain/auth-failure";
import { SignOutButton } from "./sign-out-button";

async function confirmSignOut(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "サインアウト" }));
  await user.click(screen.getByTestId("confirm-dialog-confirm"));
}

describe("SignOutButton", () => {
  it("サインアウトのボタンを表示する", () => {
    // Given
    const signOut = vi.fn();

    // When
    render(<SignOutButton signOut={signOut} />);

    // Then
    expect(
      screen.getByRole("button", { name: "サインアウト" }),
    ).toBeInTheDocument();
  });

  it("ボタンを押すと、サインアウトの確認ダイアログを表示し、まだ実行しない", async () => {
    // Given
    const user = userEvent.setup();
    const signOut = vi.fn();
    render(<SignOutButton signOut={signOut} />);

    // When
    await user.click(screen.getByRole("button", { name: "サインアウト" }));

    // Then
    expect(
      await screen.findByText("サインアウトしますか？"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "サインアウトする" }),
    ).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("完了した場合は、確認ダイアログを閉じる", async () => {
    // Given
    const user = userEvent.setup();
    const signOut = vi.fn(async () => ({ kind: "completed" }) as const);
    render(<SignOutButton signOut={signOut} />);

    // When
    await confirmSignOut(user);

    // Then
    await waitFor(() => {
      expect(
        screen.queryByText("サインアウトしますか？"),
      ).not.toBeInTheDocument();
    });
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
    render(<SignOutButton signOut={signOut} />);

    // When
    await confirmSignOut(user);

    // Then
    expect(
      await screen.findByText(
        "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("サインアウトしますか？")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-dialog-confirm")).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });

  it("文言の表が無い失敗は、認証サービスの文言のまま表示する", async () => {
    // Given
    const user = userEvent.setup();
    const signOut = vi.fn(
      async (): Promise<SignOutResult> => ({
        kind: "failed",
        failure: { kind: "other", message: "unknown failure" },
      }),
    );
    render(<SignOutButton signOut={signOut} />);

    // When
    await confirmSignOut(user);

    // Then
    expect(await screen.findByText("unknown failure")).toBeInTheDocument();
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
    const { unmount } = render(<SignOutButton signOut={signOut} />);
    await confirmSignOut(user);
    expect(view?.isMounted()).toBe(true);

    // When
    unmount();

    // Then
    expect(view?.isMounted()).toBe(false);
    await act(async () => finish({ kind: "discarded" }));
  });

  it("再描画を挟まない同じタスクの2回の確認でも、本物の手続きで認証サービスへの依頼は1回で、実行中は閉じず、完了で閉じる", async () => {
    // Given
    const user = userEvent.setup();
    const request = Promise.withResolvers<CallResult>();
    const signOutHere = vi.fn(() => request.promise);
    const session = createSession({
      authenticator: {
        signOutHere,
        readSession: vi.fn(),
        subscribe: vi.fn(() => () => {}),
      },
      identity: { read: () => null },
      connectivity: { isOffline: () => false, onOnline: () => () => {} },
      pageReplace: { here: () => "/rounds", replace: vi.fn() },
    });
    render(<SignOutButton signOut={session.signOut} />);
    await user.click(screen.getByRole("button", { name: "サインアウト" }));
    const confirm = screen.getByTestId("confirm-dialog-confirm");

    // When
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    await user.keyboard("{Escape}");

    // Then
    expect(signOutHere).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("サインアウトしますか？")).toBeInTheDocument();
    await act(async () => request.resolve({ kind: "accepted" }));
    await waitFor(() => {
      expect(
        screen.queryByText("サインアウトしますか？"),
      ).not.toBeInTheDocument();
    });
  });

  it("失敗した後は、ボタンを戻して再度確認でき、成功すれば閉じる", async () => {
    // Given
    const user = userEvent.setup();
    const signOut = vi
      .fn<(view: { isMounted(): boolean }) => Promise<SignOutResult>>()
      .mockResolvedValueOnce({ kind: "failed", failure: UNREACHABLE })
      .mockResolvedValueOnce({ kind: "completed" });
    render(<SignOutButton signOut={signOut} />);
    await confirmSignOut(user);
    await screen.findByText(NETWORK_ERROR_MESSAGE);

    // When
    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    // Then
    await waitFor(() => {
      expect(
        screen.queryByText("サインアウトしますか？"),
      ).not.toBeInTheDocument();
    });
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
    render(<SignOutButton signOut={signOut} />);
    await confirmSignOut(user);
    await screen.findByText(NETWORK_ERROR_MESSAGE);

    // When
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    await user.click(screen.getByRole("button", { name: "サインアウト" }));

    // Then
    expect(screen.getByText("サインアウトしますか？")).toBeInTheDocument();
    expect(screen.queryByText(NETWORK_ERROR_MESSAGE)).not.toBeInTheDocument();
  });

  it("別の呼び出しが実行中でbusyを返されても、表示は実行中のまま保つ", async () => {
    // Given
    const user = userEvent.setup();
    const signOut = vi.fn(
      async (): Promise<SignOutResult> => ({ kind: "busy" }),
    );
    render(<SignOutButton signOut={signOut} />);

    // When
    await confirmSignOut(user);

    // Then
    expect(screen.getByTestId("confirm-dialog-confirm")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
