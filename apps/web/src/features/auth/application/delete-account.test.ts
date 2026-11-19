import { describe, expect, it, vi } from "vitest";
import {
  type DeleteAccountEvent,
  type DeleteAccountFlow,
  deleteAccountReducer,
  initialDeleteAccountFlow,
} from "../domain/delete-account-flow";
import type { AccountDeletionResult } from "./delete-account";
import { createDeleteAccountHarness } from "./delete-account-test-helpers";
import type { CodeVerification } from "./email-otp";
import { screenHarness } from "./screen-view-test-helpers";

function setup() {
  const h = createDeleteAccountHarness();
  const screen = screenHarness<DeleteAccountFlow, DeleteAccountEvent>(
    deleteAccountReducer,
  );
  return { ...h, ...screen, view: screen.viewOf(initialDeleteAccountFlow) };
}
async function requireOtp(h: ReturnType<typeof setup>) {
  h.account.delete.mockResolvedValueOnce({
    kind: "failed",
    failure: { kind: "otp_required" },
  });
  await h.deleteAccount.submit(h.view);
  h.view.dispatch({ type: "captchaChecked", token: "check" });
}
async function sendOtp(h: ReturnType<typeof setup>) {
  await requireOtp(h);
  await h.deleteAccount.sendCode(h.view);
}

describe("アカウント削除", () => {
  it("直近OTPのある利用者は対象IDを渡して削除し端末記録とセッションを終了する", async () => {
    // Given
    const h = setup();
    // When
    await h.deleteAccount.submit(h.view);
    // Then
    expect(h.account.delete).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(h.authenticator.sendCode).not.toHaveBeenCalled();
    expect(h.eraser.erase).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(h.page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
    expect(h.view.observedState.submitting).toBe(true);
  });
  it("OTP不足では削除せず現在メールの要求段階へ進み保持を解く", async () => {
    // Given
    const h = setup();
    h.account.delete.mockResolvedValue({
      kind: "failed",
      failure: { kind: "otp_required" },
    });
    // When
    await h.deleteAccount.submit(h.view);
    // Then
    expect(h.view.observedState).toMatchObject({
      step: "request",
      userId: "user-1",
      email: "archer@example.test",
      submitting: false,
    });
    expect(h.eraser.erase).not.toHaveBeenCalled();
    expect(h.authenticator.sendCode).not.toHaveBeenCalled();
    expect(h.clock.pendingCount()).toBe(0);
  });
  it("コード送付は自動登録せず保持も取得しない", async () => {
    // Given
    const h = setup();
    await requireOtp(h);
    const hold = vi.spyOn(h.session, "holdEnd");
    // When
    await h.deleteAccount.sendCode(h.view);
    // Then
    expect(h.authenticator.sendCode).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "archer@example.test",
        captchaToken: "check",
        shouldCreateUser: false,
      }),
    );
    expect(h.view.observedState.step).toBe("code");
    expect(hold).not.toHaveBeenCalled();
  });
  it("確認結果のIDが一致したとき同じ対象で削除を完了する", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    // When
    await h.deleteAccount.verifyCode({ code: "123456" }, h.view);
    // Then
    expect(h.authenticator.verifyCode).toHaveBeenCalledWith(
      expect.objectContaining({ email: "archer@example.test", code: "123456" }),
    );
    expect(h.account.delete.mock.calls).toEqual([["user-1"], ["user-1"]]);
    expect(h.eraser.erase).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(h.page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
  });
  it.each(["send", "verify"] as const)(
    "%s前に利用者が切り替われば処理を止める",
    async (operation) => {
      // Given
      const h = setup();
      if (operation === "send") await requireOtp(h);
      else await sendOtp(h);
      h.authenticator.readCurrentAccount.mockResolvedValue({
        kind: "current",
        userId: "user-2",
        email: "other@example.test",
      });
      // When
      if (operation === "send") await h.deleteAccount.sendCode(h.view);
      else await h.deleteAccount.verifyCode({ code: "123456" }, h.view);
      // Then
      expect(h.account.delete).toHaveBeenCalledTimes(1);
      expect(h.authenticator.verifyCode).not.toHaveBeenCalled();
      expect(h.authenticator.sendCode).toHaveBeenCalledTimes(
        operation === "send" ? 0 : 1,
      );
      expect(h.eraser.erase).not.toHaveBeenCalled();
    },
  );
  it("確認応答の利用者が異なる場合はRPCを呼ばない", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    h.authenticator.verifyCode.mockResolvedValue({
      kind: "verified",
      userId: "user-2",
    });
    // When
    await h.deleteAccount.verifyCode({ code: "123456" }, h.view);
    // Then
    expect(h.account.delete).toHaveBeenCalledTimes(1);
    expect(h.eraser.erase).not.toHaveBeenCalled();
    expect(h.view.observedState.error).toBe("other");
  });
  it("同じIDでも送付先メールが変わればコードを確認しない", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    h.authenticator.readCurrentAccount.mockResolvedValue({
      kind: "current",
      userId: "user-1",
      email: "changed@example.test",
    });
    // When
    await h.deleteAccount.verifyCode({ code: "123456" }, h.view);
    // Then
    expect(h.authenticator.verifyCode).not.toHaveBeenCalled();
    expect(h.account.delete).toHaveBeenCalledTimes(1);
  });
  it("確認後もOTP不足なら再要求へ戻る", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    h.account.delete.mockResolvedValue({
      kind: "failed",
      failure: { kind: "otp_required" },
    });
    // When
    await h.deleteAccount.verifyCode({ code: "123456" }, h.view);
    // Then
    expect(h.view.observedState).toMatchObject({
      step: "request",
      pending: null,
      submitting: false,
    });
    expect(h.eraser.erase).not.toHaveBeenCalled();
  });
  it.each(["code_expired", "rate_limited", "unreachable"] as const)(
    "コード確認の%sでは削除せずコード段階を保つ",
    async (kind) => {
      // Given
      const h = setup();
      await sendOtp(h);
      h.authenticator.verifyCode.mockResolvedValue({
        kind: "failed",
        failure: { kind },
      });
      // When
      await h.deleteAccount.verifyCode({ code: "000000" }, h.view);
      // Then
      expect(h.view.observedState).toMatchObject({
        step: "code",
        error: kind,
        pending: null,
      });
      expect(h.account.delete).toHaveBeenCalledTimes(1);
      expect(h.eraser.erase).not.toHaveBeenCalled();
    },
  );
  it("削除結果不明なら記録を消さず通信エラーを示す", async () => {
    // Given
    const h = setup();
    h.account.delete.mockResolvedValue({
      kind: "failed",
      failure: { kind: "unreachable" },
    });
    // When
    await h.deleteAccount.submit(h.view);
    // Then
    expect(h.eraser.erase).not.toHaveBeenCalled();
    expect(h.page.replace).not.toHaveBeenCalled();
    expect(h.view.observedState.error).toBe("unreachable");
  });
  it("消去失敗でも削除済み利用者のセッションを終了する", async () => {
    // Given
    const h = setup();
    h.eraser.erase.mockRejectedValue(new Error("storage"));
    // When
    await h.deleteAccount.submit(h.view);
    // Then
    expect(h.page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
  });
  it("削除の二重押下はRPCを重複させない", async () => {
    // Given
    const h = setup();
    // When
    await Promise.all([
      h.deleteAccount.submit(h.view),
      h.deleteAccount.submit(h.view),
    ]);
    // Then
    expect(h.account.delete).toHaveBeenCalledOnce();
  });
  it("90秒上限で保持を解き遅い削除成功で記録を消さない", async () => {
    // Given
    const h = setup();
    const response = Promise.withResolvers<AccountDeletionResult>();
    h.account.delete.mockReturnValue(response.promise);
    const running = h.deleteAccount.submit(h.view);
    await h.clock.advanceAsync(89999);
    const before = h.view.observedState.submitting;
    // When
    await h.clock.advanceAsync(1);
    await running;
    response.resolve({ kind: "deleted" });
    await h.clock.advanceAsync(1);
    // Then
    expect(before).toBe(true);
    expect(h.view.observedState).toMatchObject({
      submitting: false,
      error: "unreachable",
    });
    expect(h.eraser.erase).not.toHaveBeenCalled();
  });
  it("確認中の90秒上限後は遅い成功でも削除RPCを開始しない", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    const response = Promise.withResolvers<CodeVerification>();
    h.authenticator.verifyCode.mockReturnValue(response.promise);
    const running = h.deleteAccount.verifyCode({ code: "123456" }, h.view);
    await h.clock.advanceAsync(90000);
    await running;
    // When
    response.resolve({ kind: "verified", userId: "user-1" });
    await h.clock.advanceAsync(1);
    // Then
    expect(h.account.delete).toHaveBeenCalledTimes(1);
    expect(h.eraser.erase).not.toHaveBeenCalled();
  });
});

it("確認応答を待つ間に現在メールが変わった場合は削除を開始しない", async () => {
  // Given
  const h = setup();
  await sendOtp(h);
  const response = Promise.withResolvers<CodeVerification>();
  h.authenticator.verifyCode.mockReturnValue(response.promise);
  const running = h.deleteAccount.verifyCode({ code: "123456" }, h.view);
  await vi.waitFor(() => expect(h.authenticator.verifyCode).toHaveBeenCalled());
  h.authenticator.readCurrentAccount.mockResolvedValue({
    kind: "current",
    userId: "user-1",
    email: "changed@example.test",
  });
  // When
  response.resolve({ kind: "verified", userId: "user-1" });
  await running;
  // Then
  expect(h.account.delete).toHaveBeenCalledTimes(1);
  expect(h.eraser.erase).not.toHaveBeenCalled();
});

it("削除応答待ちにSIGNED_OUTを受けても成功後だけ遷移元なしで終了する", async () => {
  // Given
  const h = setup();
  const stop = h.session.watch();
  const response = Promise.withResolvers<AccountDeletionResult>();
  h.account.delete.mockReturnValue(response.promise);
  const running = h.deleteAccount.submit(h.view);
  await vi.waitFor(() => expect(h.account.delete).toHaveBeenCalledOnce());
  // When
  h.emit({ kind: "signed-out" });
  const before = h.page.replace.mock.calls.length;
  response.resolve({ kind: "deleted" });
  await running;
  stop();
  // Then
  expect(before).toBe(0);
  expect(h.page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
});

it("削除応答待ちに離脱しても成功確認後の消去と終了は進める", async () => {
  // Given
  const h = setup();
  const response = Promise.withResolvers<AccountDeletionResult>();
  h.account.delete.mockReturnValue(response.promise);
  const running = h.deleteAccount.submit(h.view);
  await vi.waitFor(() => expect(h.account.delete).toHaveBeenCalledOnce());
  h.screen.mounted = false;
  // When
  response.resolve({ kind: "deleted" });
  await running;
  // Then
  expect(h.events).toEqual([]);
  expect(h.eraser.erase).toHaveBeenCalledExactlyOnceWith("user-1");
  expect(h.page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
});

it("再送待機の計時は1秒後に残り秒数を進める出来事を送る", () => {
  // Given
  const h = setup();
  const dispatch = vi.fn();
  // When
  h.deleteAccount.tickCooldown(dispatch);
  h.clock.advance(1000);
  // Then
  expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "cooldownTicked" });
});

describe("対象の確認と排他の失敗", () => {
  it("サインアウトが進行中で保持を取れないときは削除を開始せず通信エラーを示す", async () => {
    // Given
    const h = setup();
    vi.spyOn(h.session, "holdEnd").mockReturnValue(null);
    // When
    await h.deleteAccount.submit(h.view);
    // Then
    expect(h.account.delete).not.toHaveBeenCalled();
    expect(h.view.observedState).toMatchObject({
      submitting: false,
      error: "unreachable",
    });
  });
  it("意思確認で現在の利用者の取得に失敗したときは削除を開始せずその失敗を示す", async () => {
    // Given
    const h = setup();
    h.authenticator.readCurrentAccount.mockResolvedValue({
      kind: "failed",
      failure: { kind: "unreachable" },
    });
    // When
    await h.deleteAccount.submit(h.view);
    // Then
    expect(h.account.delete).not.toHaveBeenCalled();
    expect(h.eraser.erase).not.toHaveBeenCalled();
    expect(h.view.observedState).toMatchObject({
      submitting: false,
      error: "unreachable",
    });
  });
  it("意思確認で認証の喪失が分かったときは削除を開始せずセッションの読み直しへ委ねる", async () => {
    // Given
    const h = setup();
    h.authenticator.readCurrentAccount.mockResolvedValue({ kind: "lost" });
    // When
    await h.deleteAccount.submit(h.view);
    // Then
    expect(h.account.delete).not.toHaveBeenCalled();
    expect(h.authenticator.readSession).toHaveBeenCalledWith({ refresh: true });
    expect(h.view.observedState.submitting).toBe(false);
  });
  it.each(["send", "verify"] as const)(
    "%s前の現在の利用者の取得に失敗したときは要求を出さずその失敗を示す",
    async (operation) => {
      // Given
      const h = setup();
      if (operation === "send") await requireOtp(h);
      else await sendOtp(h);
      h.authenticator.readCurrentAccount.mockResolvedValue({
        kind: "failed",
        failure: { kind: "unreachable" },
      });
      // When
      if (operation === "send") await h.deleteAccount.sendCode(h.view);
      else await h.deleteAccount.verifyCode({ code: "123456" }, h.view);
      // Then
      expect(h.authenticator.sendCode).toHaveBeenCalledTimes(
        operation === "send" ? 0 : 1,
      );
      expect(h.authenticator.verifyCode).not.toHaveBeenCalled();
      expect(h.account.delete).toHaveBeenCalledTimes(1);
      expect(h.view.observedState.error).toBe("unreachable");
    },
  );
  it("確認応答の後の現在の利用者の取得に失敗したときは削除を開始せずその失敗を示す", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    const current = await h.authenticator.readCurrentAccount();
    h.authenticator.readCurrentAccount
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({
        kind: "failed",
        failure: { kind: "unreachable" },
      });
    // When
    await h.deleteAccount.verifyCode({ code: "123456" }, h.view);
    // Then
    expect(h.authenticator.verifyCode).toHaveBeenCalledOnce();
    expect(h.account.delete).toHaveBeenCalledTimes(1);
    expect(h.eraser.erase).not.toHaveBeenCalled();
    expect(h.view.observedState.error).toBe("unreachable");
  });
  it("完了のサインアウトが失敗したときは通信エラーを示して操作を戻す", async () => {
    // Given
    const h = setup();
    h.authenticator.signOutHere.mockResolvedValue({
      kind: "failed",
      failure: { kind: "unreachable" },
    });
    // When
    await h.deleteAccount.submit(h.view);
    // Then
    expect(h.eraser.erase).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(h.page.replace).not.toHaveBeenCalled();
    expect(h.view.observedState).toMatchObject({
      submitting: false,
      error: "unreachable",
    });
  });
});

describe("コード送付と確認の失敗・排他・離脱", () => {
  it("コード送付が拒否されたときは要求の段階に留まりその失敗を示す", async () => {
    // Given
    const h = setup();
    await requireOtp(h);
    h.authenticator.sendCode.mockResolvedValue({
      kind: "failed",
      failure: { kind: "rate_limited" },
    });
    // When
    await h.deleteAccount.sendCode(h.view);
    // Then
    expect(h.view.observedState).toMatchObject({
      step: "request",
      error: "rate_limited",
    });
    expect(h.account.delete).toHaveBeenCalledTimes(1);
  });
  it.each(["send", "verify"] as const)(
    "オフラインでは%sの対象確認も要求も行わない",
    async (operation) => {
      // Given
      const h = setup();
      if (operation === "send") await requireOtp(h);
      else await sendOtp(h);
      h.authenticator.readCurrentAccount.mockClear();
      h.connectivity.goOffline();
      // When
      if (operation === "send") await h.deleteAccount.sendCode(h.view);
      else await h.deleteAccount.verifyCode({ code: "123456" }, h.view);
      // Then
      expect(h.authenticator.readCurrentAccount).not.toHaveBeenCalled();
      expect(h.authenticator.sendCode).toHaveBeenCalledTimes(
        operation === "send" ? 0 : 1,
      );
      expect(h.authenticator.verifyCode).not.toHaveBeenCalled();
    },
  );
  it("コード送付の対象確認を待つ間に画面を離れると送付を始めない", async () => {
    // Given
    const h = setup();
    await requireOtp(h);
    const response =
      Promise.withResolvers<
        Awaited<ReturnType<typeof h.authenticator.readCurrentAccount>>
      >();
    h.authenticator.readCurrentAccount.mockReturnValue(response.promise);
    const running = h.deleteAccount.sendCode(h.view);
    h.screen.mounted = false;
    // When
    response.resolve({
      kind: "current",
      userId: "user-1",
      email: "archer@example.test",
    });
    await running;
    // Then
    expect(h.authenticator.sendCode).not.toHaveBeenCalled();
  });
  it("コード送付の応答を待つ間に画面を離れると遅い応答で段階を進めない", async () => {
    // Given
    const h = setup();
    await requireOtp(h);
    const response =
      Promise.withResolvers<
        Awaited<ReturnType<typeof h.authenticator.sendCode>>
      >();
    h.authenticator.sendCode.mockReturnValue(response.promise);
    const running = h.deleteAccount.sendCode(h.view);
    await vi.waitFor(() => expect(h.authenticator.sendCode).toHaveBeenCalled());
    h.screen.mounted = false;
    // When
    response.resolve({ kind: "accepted" });
    await running;
    // Then
    expect(h.view.observedState.step).toBe("request");
    expect(h.events.map(({ type }) => type)).not.toContain("codeSent");
  });
  it("離脱後に削除が確定失敗しても遅い表示更新を行わない", async () => {
    // Given
    const h = setup();
    const response = Promise.withResolvers<AccountDeletionResult>();
    h.account.delete.mockReturnValue(response.promise);
    const running = h.deleteAccount.submit(h.view);
    await vi.waitFor(() => expect(h.account.delete).toHaveBeenCalled());
    h.screen.mounted = false;
    // When
    response.resolve({ kind: "failed", failure: { kind: "other" } });
    await running;
    // Then
    expect(h.events).toEqual([]);
    expect(h.eraser.erase).not.toHaveBeenCalled();
  });
  it.each([
    ["意思確認", 0],
    ["確認前", 1],
    ["確認応答の後", 2],
  ] as const)(
    "%sの対象確認が90秒上限まで応答しないと遅い応答で確認も削除も始めない",
    async (_point, resolvedBefore) => {
      // Given
      const h = setup();
      if (resolvedBefore > 0) await sendOtp(h);
      const current = await h.authenticator.readCurrentAccount();
      const response = Promise.withResolvers<typeof current>();
      if (resolvedBefore === 2)
        h.authenticator.readCurrentAccount.mockResolvedValueOnce(current);
      h.authenticator.readCurrentAccount.mockReturnValueOnce(response.promise);
      const before = {
        deletes: h.account.delete.mock.calls.length,
        verifies: resolvedBefore === 2 ? 1 : 0,
      };
      const running =
        resolvedBefore === 0
          ? h.deleteAccount.submit(h.view)
          : h.deleteAccount.verifyCode({ code: "123456" }, h.view);
      await h.clock.advanceAsync(90000);
      await running;
      // When
      response.resolve(current);
      await h.clock.advanceAsync(1);
      // Then
      expect(h.account.delete).toHaveBeenCalledTimes(before.deletes);
      expect(h.authenticator.verifyCode).toHaveBeenCalledTimes(before.verifies);
      expect(h.eraser.erase).not.toHaveBeenCalled();
      expect(h.view.observedState.error).toBe("unreachable");
    },
  );
});
