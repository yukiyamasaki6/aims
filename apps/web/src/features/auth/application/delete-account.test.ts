import { describe, expect, it } from "vitest";
import {
  type AuthFailure,
  type AuthFailureKind,
  UNREACHABLE,
} from "../domain/auth-failure";
import {
  type DeleteAccountEvent,
  deleteAccountReducer,
  initialDeleteAccountFlow,
} from "../domain/delete-account-flow";
import { HOLD_TIMEOUT_MS } from "../domain/session-end-flow";
import type {
  AccountDeletionResult,
  ReauthenticationResult,
} from "./delete-account";
import { createDeleteAccountHarness } from "./delete-account-test-helpers";
import { screenHarness } from "./screen-view-test-helpers";

const input = { password: "password-current1" };
const checkedFlow = { ...initialDeleteAccountFlow, captchaToken: "token-1" };
const signedOut = { kind: "signed-out" } as const;

function setup(options: Parameters<typeof createDeleteAccountHarness>[0] = {}) {
  return {
    ...createDeleteAccountHarness(options),
    ...screenHarness<
      ReturnType<typeof deleteAccountReducer>,
      DeleteAccountEvent
    >(deleteAccountReducer),
  };
}

async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

const failed = (
  kind: AuthFailureKind,
): { kind: "failed"; failure: AuthFailure } => ({
  kind: "failed",
  failure: { kind },
});

describe("アカウント削除の手続き", () => {
  describe("成功", () => {
    it("再認証と削除が成功すると、その利用者のIDで端末の記録を消し、この端末のサインインを終えて、遷移元の無いサインインへ移る", async () => {
      // Given
      const { deleteAccount, eraser, authenticator, page, viewOf } = setup({
        here: "/rounds#settings/account/delete-account",
      });

      // When
      await deleteAccount.submit(input, viewOf(checkedFlow));

      // Then
      expect(authenticator.reauthenticate).toHaveBeenCalledExactlyOnceWith({
        password: "password-current1",
        captchaToken: "token-1",
      });
      expect(eraser.erase).toHaveBeenCalledExactlyOnceWith("user-1");
      expect(authenticator.signOutHere).toHaveBeenCalledOnce();
      expect(page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
    });

    it("成功では、失敗を示さず、チェックのやり直しも頼まない(遷移まで処理中のまま)", async () => {
      // Given
      const { deleteAccount, events, resetCheck, viewOf } = setup();
      const view = viewOf(checkedFlow);

      // When
      await deleteAccount.submit(input, view);

      // Then
      expect(events).toEqual([]);
      expect(resetCheck).not.toHaveBeenCalled();
      expect(view.observedState.submitting).toBe(true);
    });

    it("端末の記録の消去が失敗しても、握りつぶされ、サインインの終了と遷移が行われる", async () => {
      // Given
      const { deleteAccount, eraser, authenticator, page, viewOf } = setup();
      eraser.erase.mockRejectedValue(new Error("storage"));

      // When
      await deleteAccount.submit(input, viewOf(checkedFlow));

      // Then
      expect(authenticator.signOutHere).toHaveBeenCalledOnce();
      expect(page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
    });

    it("削除の応答を待つ間にサインインの喪失を検知しても、遷移元つきで移らず、削除の完了の遷移(遷移元なし)になる", async () => {
      // Given
      const { deleteAccount, session, account, page, emit, viewOf } = setup();
      session.watch();
      const response = Promise.withResolvers<AccountDeletionResult>();
      account.delete.mockReturnValue(response.promise);
      const running = deleteAccount.submit(input, viewOf(checkedFlow));
      await flush();

      // When
      emit(signedOut);
      const duringWait = page.replace.mock.calls.length;
      response.resolve({ kind: "deleted" });
      await running;

      // Then
      expect(duringWait).toBe(0);
      expect(page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
    });
  });

  describe("削除が行われなかったことが確実な失敗", () => {
    it.each<[string, AuthFailureKind]>([
      ["パスワードの誤り", "current_password_invalid"],
      ["制限", "rate_limited"],
      ["チェックの失敗", "captcha_failed"],
      ["通信の失敗(応答なし)", "unreachable"],
    ])(
      "再認証が%sなら、削除も消去もせず、保持を解いて理由を示し、サインインを維持する",
      async (_name, kind) => {
        // Given
        const {
          deleteAccount,
          authenticator,
          account,
          eraser,
          page,
          session,
          resetCheck,
          viewOf,
        } = setup();
        authenticator.reauthenticate.mockResolvedValue(failed(kind));
        const view = viewOf(checkedFlow);

        // When
        await deleteAccount.submit(input, view);

        // Then
        expect(account.delete).not.toHaveBeenCalled();
        expect(eraser.erase).not.toHaveBeenCalled();
        expect(view.observedState).toMatchObject({
          error: kind,
          submitting: false,
        });
        expect(resetCheck).toHaveBeenCalledOnce();
        expect(page.replace).not.toHaveBeenCalled();
        expect(session.holdEnd()).not.toBeNull();
      },
    );

    it.each<[string, AuthFailureKind]>([
      ["DBの拒否(PT403を含むコード付き)", "other"],
    ])(
      "削除が%sなら、消去せず、保持を解いて理由を示し、サインインを維持する",
      async (_name, kind) => {
        // Given
        const { deleteAccount, account, eraser, page, session, viewOf } =
          setup();
        account.delete.mockResolvedValue(failed(kind));
        const view = viewOf(checkedFlow);

        // When
        await deleteAccount.submit(input, view);

        // Then
        expect(eraser.erase).not.toHaveBeenCalled();
        expect(view.observedState).toMatchObject({
          error: kind,
          submitting: false,
        });
        expect(page.replace).not.toHaveBeenCalled();
        expect(session.holdEnd()).not.toBeNull();
      },
    );

    it("削除の応答が無い・コードの無い応答(結果不明)なら、通信エラーを示し、端末の記録は消さない", async () => {
      // Given
      const { deleteAccount, account, eraser, viewOf } = setup();
      account.delete.mockResolvedValue({
        kind: "failed",
        failure: UNREACHABLE,
      });
      const view = viewOf(checkedFlow);

      // When
      await deleteAccount.submit(input, view);

      // Then
      expect(view.observedState.error).toBe("unreachable");
      expect(eraser.erase).not.toHaveBeenCalled();
    });

    it("再認証が成功した後に削除が失敗しても、トークンを消費してチェックをやり直させ、次は再認証からやり直す", async () => {
      // Given
      const { deleteAccount, authenticator, account, resetCheck, viewOf } =
        setup();
      account.delete.mockResolvedValueOnce(failed("other"));
      const view = viewOf(checkedFlow);
      await deleteAccount.submit(input, view);
      const afterFailure = view.observedState;

      // When
      view.dispatch({ type: "captchaChecked", token: "token-2" });
      await deleteAccount.submit(input, view);

      // Then
      expect(afterFailure.captchaToken).toBeNull();
      expect(resetCheck).toHaveBeenCalled();
      expect(authenticator.reauthenticate).toHaveBeenCalledTimes(2);
      expect(authenticator.reauthenticate).toHaveBeenLastCalledWith({
        password: "password-current1",
        captchaToken: "token-2",
      });
    });
  });

  describe("サインインの喪失", () => {
    it("再認証の前の確認が認証サービスに拒否されたとき、更新を強制した読み取りで喪失を確定して、遷移元つきのサインインへ移り、削除は呼ばない", async () => {
      // Given
      const { deleteAccount, authenticator, account, state, page, viewOf } =
        setup({
          here: "/rounds#settings/account/delete-account",
        });
      authenticator.reauthenticate.mockImplementation(async () => {
        state.status = "unauthenticated";
        return { kind: "lost" };
      });
      const view = viewOf(checkedFlow);

      // When
      await deleteAccount.submit(input, view);

      // Then
      expect(authenticator.readSession).toHaveBeenCalledWith({
        refresh: true,
      });
      expect(account.delete).not.toHaveBeenCalled();
      expect(page.replace).toHaveBeenCalledExactlyOnceWith(
        "/signin?returnTo=%2Frounds%23settings%2Faccount%2Fdelete-account",
      );
      expect(view.observedState.error).toBe("unreachable");
    });
  });

  describe("保持の上限と世代", () => {
    it("再認証から削除の応答までが90秒に達すると、通信エラーを示して入力へ戻る。89秒では打ち切らない", async () => {
      // Given
      const { deleteAccount, authenticator, clock, viewOf } = setup();
      authenticator.reauthenticate.mockReturnValue(new Promise(() => {}));
      const view = viewOf(checkedFlow);
      void deleteAccount.submit(input, view);
      await flush();

      // When
      await clock.advanceAsync(HOLD_TIMEOUT_MS - 1_000);
      const before = view.observedState;
      await clock.advanceAsync(2_000);

      // Then
      expect(before).toMatchObject({ submitting: true, error: null });
      expect(view.observedState).toMatchObject({
        submitting: false,
        error: "unreachable",
      });
    });

    it.each<[string, AccountDeletionResult]>([
      ["成功", { kind: "deleted" }],
      ["失敗", failed("other")],
    ])(
      "打ち切りの後に遅れて届いた削除の%sは、端末の記録を消さず、遷移も表示の書き換えもしない",
      async (_name, late) => {
        // Given
        const {
          deleteAccount,
          account,
          eraser,
          page,
          clock,
          authenticator,
          viewOf,
        } = setup();
        const response = Promise.withResolvers<AccountDeletionResult>();
        account.delete.mockReturnValue(response.promise);
        const view = viewOf(checkedFlow);
        const running = deleteAccount.submit(input, view);
        await clock.advanceAsync(HOLD_TIMEOUT_MS);
        await running;
        const afterExpiry = view.observedState;

        // When
        response.resolve(late);
        await flush();

        // Then
        expect(view.observedState).toEqual(afterExpiry);
        expect(afterExpiry.error).toBe("unreachable");
        expect(eraser.erase).not.toHaveBeenCalled();
        expect(authenticator.signOutHere).not.toHaveBeenCalled();
        expect(page.replace).not.toHaveBeenCalled();
      },
    );

    it("削除の応答を受けた時点で上限の計時を止め、その後のサインインの終了が長引いても、保持の上限では打ち切らない", async () => {
      // Given
      const { deleteAccount, account, authenticator, clock, viewOf } = setup();
      const response = Promise.withResolvers<AccountDeletionResult>();
      account.delete.mockReturnValue(response.promise);
      authenticator.signOutHere.mockReturnValue(new Promise(() => {}));
      const view = viewOf(checkedFlow);
      void deleteAccount.submit(input, view);
      await clock.advanceAsync(85_000);
      response.resolve({ kind: "deleted" });
      await flush();

      // When
      await clock.advanceAsync(7_000);
      const afterHoldLimit = view.observedState;
      await clock.advanceAsync(3_000);

      // Then
      expect(afterHoldLimit).toMatchObject({ submitting: true, error: null });
      expect(view.observedState.error).toBe("unreachable");
    });
  });

  describe("サインインの終了を確かめられない", () => {
    it("削除と消去は済んだまま、保持を解き、通信エラーを示して入力へ戻り、サインアウトも実行できる", async () => {
      // Given
      const {
        deleteAccount,
        session,
        authenticator,
        eraser,
        page,
        state,
        viewOf,
      } = setup();
      authenticator.signOutHere.mockImplementation(async () => ({
        kind: "accepted",
      }));
      state.status = "authenticated";
      const view = viewOf(checkedFlow);

      // When
      await deleteAccount.submit(input, view);
      const signOut = await session.signOut();

      // Then
      expect(eraser.erase).toHaveBeenCalledExactlyOnceWith("user-1");
      expect(view.observedState).toMatchObject({
        error: "unreachable",
        submitting: false,
      });
      expect(authenticator.signOutHere).toHaveBeenCalledTimes(2);
      expect(signOut.kind).toBe("failed");
      expect(page.replace).not.toHaveBeenCalled();
    });
  });

  describe("オフラインと重複", () => {
    it("オフラインでは、再認証も削除も行わず、オフラインの理由を示し、通信が戻ると再び実行できる", async () => {
      // Given
      const { deleteAccount, authenticator, account, connectivity, viewOf } =
        setup({ offline: true });
      const view = viewOf(checkedFlow);
      await deleteAccount.submit(input, view);
      const whileOffline = {
        state: view.observedState,
        reauthentications: authenticator.reauthenticate.mock.calls.length,
        deletions: account.delete.mock.calls.length,
      };

      // When
      connectivity.goOnline();
      await deleteAccount.submit(input, view);

      // Then
      expect(whileOffline.state.error).toBe("offline");
      expect(whileOffline.reauthentications).toBe(0);
      expect(whileOffline.deletions).toBe(0);
      expect(authenticator.reauthenticate).toHaveBeenCalledOnce();
      expect(account.delete).toHaveBeenCalledOnce();
    });

    it("処理中の再度の送信は、再認証も削除も増やさない", async () => {
      // Given
      const { deleteAccount, authenticator, account, viewOf } = setup();
      const response = Promise.withResolvers<ReauthenticationResult>();
      authenticator.reauthenticate.mockReturnValue(response.promise);
      const view = viewOf(checkedFlow);
      const first = deleteAccount.submit(input, view);

      // When
      await deleteAccount.submit(input, view);
      response.resolve({ kind: "verified", userId: "user-1" });
      await first;

      // Then
      expect(authenticator.reauthenticate).toHaveBeenCalledOnce();
      expect(account.delete).toHaveBeenCalledOnce();
    });

    it("サインアウトの実行中は、再認証を始めず、通信エラーを示して入力へ戻る", async () => {
      // Given
      const { deleteAccount, session, authenticator, viewOf } = setup();
      authenticator.signOutHere.mockReturnValue(new Promise(() => {}));
      void session.signOut();
      const view = viewOf(checkedFlow);

      // When
      await deleteAccount.submit(input, view);

      // Then
      expect(authenticator.reauthenticate).not.toHaveBeenCalled();
      expect(view.observedState).toMatchObject({
        error: "unreachable",
        submitting: false,
      });
    });

    it("入力に不備があれば、保持も取らず、再認証を始めない", async () => {
      // Given
      const { deleteAccount, authenticator, session, viewOf } = setup();

      // When
      await deleteAccount.submit({ password: "" }, viewOf(checkedFlow));

      // Then
      expect(authenticator.reauthenticate).not.toHaveBeenCalled();
      expect(session.holdEnd()).not.toBeNull();
    });
  });

  describe("画面を離れた後", () => {
    it("応答を待つ間に画面を離れても、成功なら端末の記録の消去とサインインの終了を進め、表示は変えない", async () => {
      // Given
      const {
        deleteAccount,
        account,
        eraser,
        authenticator,
        page,
        events,
        screen,
        viewOf,
      } = setup();
      const response = Promise.withResolvers<AccountDeletionResult>();
      account.delete.mockReturnValue(response.promise);
      const running = deleteAccount.submit(input, viewOf(checkedFlow));
      await flush();

      // When
      screen.mounted = false;
      response.resolve({ kind: "deleted" });
      await running;

      // Then
      expect(eraser.erase).toHaveBeenCalledExactlyOnceWith("user-1");
      expect(authenticator.signOutHere).toHaveBeenCalledOnce();
      expect(page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
      expect(events).toEqual([]);
    });

    it("応答を待つ間に画面を離れると、失敗でも表示を変えず、保持は解く", async () => {
      // Given
      const { deleteAccount, account, session, events, screen, viewOf } =
        setup();
      const response = Promise.withResolvers<AccountDeletionResult>();
      account.delete.mockReturnValue(response.promise);
      const running = deleteAccount.submit(input, viewOf(checkedFlow));
      await flush();

      // When
      screen.mounted = false;
      response.resolve(failed("other"));
      await running;

      // Then
      expect(events).toEqual([]);
      expect(session.holdEnd()).not.toBeNull();
    });
  });
});
