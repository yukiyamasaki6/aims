import { describe, expect, it, vi } from "vitest";
import {
  type DeleteAccountEvent,
  type DeleteAccountFlow,
  deleteAccountReducer,
  initialDeleteAccountFlow,
} from "../domain/delete-account-flow";
import type { CallResult } from "./call-result";
import type {
  AccountDeletionResult,
  CurrentAccountResult,
} from "./delete-account";
import { createDeleteAccountHarness } from "./delete-account-test-helpers";
import type { CodeVerification } from "./email-otp";
import { screenHarness } from "./screen-view-test-helpers";

const CURRENT: CurrentAccountResult = {
  kind: "current",
  userId: "user-1",
  email: "archer@example.test",
};

function setup() {
  const h = createDeleteAccountHarness();
  const screen = screenHarness<DeleteAccountFlow, DeleteAccountEvent>(
    deleteAccountReducer,
  );
  return { ...h, ...screen, view: screen.viewOf(initialDeleteAccountFlow) };
}
// 意思確認の画面でチェックが完了した状態にする。
function ready(h: ReturnType<typeof setup>) {
  h.view.dispatch({ type: "captchaChecked", token: "check" });
}
// コード入力で再送待機の60秒が過ぎ、チェックを取り直した状態にする。
function passResendWait(h: ReturnType<typeof setup>) {
  for (let second = 0; second < 60; second += 1)
    h.view.dispatch({ type: "cooldownTicked" });
  h.view.dispatch({ type: "captchaChecked", token: "resend-check" });
}
async function sendOtp(h: ReturnType<typeof setup>) {
  ready(h);
  await h.deleteAccount.sendCode(h.view);
}

describe("アカウント削除", () => {
  it("「アカウントを削除」の送信は、直近にOTPでログインしていても削除を呼ばず、自動登録せずに現在メールへコードを送ってコード入力へ進み、保持を取得しない", async () => {
    // Given
    const h = setup();
    ready(h);
    const hold = vi.spyOn(h.session, "holdEnd");
    // When
    await h.deleteAccount.sendCode(h.view);
    // Then
    expect(h.authenticator.sendCode).toHaveBeenCalledExactlyOnceWith({
      email: "archer@example.test",
      captchaToken: "check",
      shouldCreateUser: false,
    });
    expect(h.view.observedState).toMatchObject({
      step: "code",
      userId: "user-1",
      email: "archer@example.test",
      pending: null,
      error: null,
    });
    expect(h.account.delete).not.toHaveBeenCalled();
    expect(h.eraser.erase).not.toHaveBeenCalled();
    expect(hold).not.toHaveBeenCalled();
  });
  it("チェックが未完了の押下は、現在の利用者の取得も送付も始めず、意思確認のまま処理中として待つ", async () => {
    // Given
    const h = setup();
    // When
    await h.deleteAccount.sendCode(h.view);
    // Then
    expect(h.authenticator.readCurrentAccount).not.toHaveBeenCalled();
    expect(h.authenticator.sendCode).not.toHaveBeenCalled();
    expect(h.view.observedState).toMatchObject({
      step: "confirmation",
      pending: "send",
      awaitingCheck: true,
    });
  });
  it("コードを確認し、確認後に読み直した現在の利用者とメールが依頼時と一致すると、同じ対象で削除し、端末記録を消して遷移元なしのサインインへ進む", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    // When
    await h.deleteAccount.verifyCode({ code: "123456" }, h.view);
    // Then
    expect(h.authenticator.verifyCode).toHaveBeenCalledWith(
      expect.objectContaining({ email: "archer@example.test", code: "123456" }),
    );
    expect(h.account.delete).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(h.eraser.erase).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(h.page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
    expect(h.view.observedState.pending).toBe("verify");
  });
  it("消去失敗でも削除済み利用者のセッションを終了する", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    h.eraser.erase.mockRejectedValue(new Error("storage"));
    // When
    await h.deleteAccount.verifyCode({ code: "123456" }, h.view);
    // Then
    expect(h.page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
  });
  it.each(["send", "verify"] as const)(
    "コード入力で%s前に利用者が切り替われば、要求を出さずコード入力に留まってエラーを示す",
    async (operation) => {
      // Given
      const h = setup();
      await sendOtp(h);
      if (operation === "send") passResendWait(h);
      h.authenticator.readCurrentAccount.mockResolvedValue({
        kind: "current",
        userId: "user-2",
        email: "other@example.test",
      });
      // When
      if (operation === "send") await h.deleteAccount.sendCode(h.view);
      else await h.deleteAccount.verifyCode({ code: "123456" }, h.view);
      // Then
      expect(h.account.delete).not.toHaveBeenCalled();
      expect(h.authenticator.verifyCode).not.toHaveBeenCalled();
      expect(h.authenticator.sendCode).toHaveBeenCalledTimes(1);
      expect(h.eraser.erase).not.toHaveBeenCalled();
      expect(h.view.observedState).toMatchObject({
        step: "code",
        error: "other",
        pending: null,
      });
    },
  );
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
    expect(h.account.delete).not.toHaveBeenCalled();
  });
  it("確認応答を待つ間に現在メールが変わった場合は削除を開始せず、意思確認へ戻ってその他の失敗を示す", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    const response = Promise.withResolvers<CodeVerification>();
    h.authenticator.verifyCode.mockReturnValue(response.promise);
    const running = h.deleteAccount.verifyCode({ code: "123456" }, h.view);
    await vi.waitFor(() =>
      expect(h.authenticator.verifyCode).toHaveBeenCalled(),
    );
    h.authenticator.readCurrentAccount.mockResolvedValue({
      kind: "current",
      userId: "user-1",
      email: "changed@example.test",
    });
    // When
    response.resolve({ kind: "verified" });
    await running;
    // Then
    expect(h.account.delete).not.toHaveBeenCalled();
    expect(h.eraser.erase).not.toHaveBeenCalled();
    expect(h.view.observedState).toMatchObject({
      step: "confirmation",
      error: "other",
      pending: null,
    });
  });
  it("確認後の削除が失敗（拒否・確定失敗・結果不明の区別なし）で終わると、記録を消さず、意思確認へ戻ってその他の失敗を示し、対象と再送待機を保ってトークンを破棄し、保持を解く", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    h.view.dispatch({ type: "captchaChecked", token: "resend-check" });
    h.account.delete.mockResolvedValue({ kind: "failed" });
    // When
    await h.deleteAccount.verifyCode({ code: "123456" }, h.view);
    // Then
    expect(h.view.observedState).toMatchObject({
      step: "confirmation",
      error: "other",
      pending: null,
      userId: "user-1",
      email: "archer@example.test",
      resendCooldown: 60,
      captchaToken: null,
    });
    expect(h.eraser.erase).not.toHaveBeenCalled();
    expect(h.page.replace).not.toHaveBeenCalled();
    expect(h.clock.pendingCount()).toBe(0);
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
      expect(h.account.delete).not.toHaveBeenCalled();
      expect(h.eraser.erase).not.toHaveBeenCalled();
    },
  );
});

describe("排他と保持", () => {
  it("「アカウントを削除」の二重押下は現在の利用者の取得も送付も重複させない", async () => {
    // Given
    const h = setup();
    ready(h);
    // When
    await Promise.all([
      h.deleteAccount.sendCode(h.view),
      h.deleteAccount.sendCode(h.view),
    ]);
    // Then
    expect(h.authenticator.readCurrentAccount).toHaveBeenCalledOnce();
    expect(h.authenticator.sendCode).toHaveBeenCalledOnce();
    expect(h.account.delete).not.toHaveBeenCalled();
  });
  it("確認して削除の二重押下はコード確認も削除も重複させない", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    // When
    await Promise.all([
      h.deleteAccount.verifyCode({ code: "123456" }, h.view),
      h.deleteAccount.verifyCode({ code: "123456" }, h.view),
    ]);
    // Then
    expect(h.authenticator.verifyCode).toHaveBeenCalledOnce();
    expect(h.account.delete).toHaveBeenCalledOnce();
  });
  it("サインアウトが進行中で保持を取れないときはコード確認も削除も開始せず通信エラーを示す", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    vi.spyOn(h.session, "holdEnd").mockReturnValue(null);
    // When
    await h.deleteAccount.verifyCode({ code: "123456" }, h.view);
    // Then
    expect(h.authenticator.verifyCode).not.toHaveBeenCalled();
    expect(h.account.delete).not.toHaveBeenCalled();
    expect(h.view.observedState).toMatchObject({
      pending: null,
      error: "unreachable",
    });
  });
  it("削除応答待ちにSIGNED_OUTを受けても成功後だけ遷移元なしで終了する", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    const stop = h.session.watch();
    const response = Promise.withResolvers<AccountDeletionResult>();
    h.account.delete.mockReturnValue(response.promise);
    const running = h.deleteAccount.verifyCode({ code: "123456" }, h.view);
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
  it("削除の応答が90秒の1ms前までは保持し、90秒で保持を解いて通信エラーを示し、遅い成功で記録を消さない", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    const response = Promise.withResolvers<AccountDeletionResult>();
    h.account.delete.mockReturnValue(response.promise);
    const running = h.deleteAccount.verifyCode({ code: "123456" }, h.view);
    await h.clock.advanceAsync(89999);
    const before = h.view.observedState.pending;
    // When
    await h.clock.advanceAsync(1);
    await running;
    response.resolve({ kind: "deleted" });
    await h.clock.advanceAsync(1);
    // Then
    expect(before).toBe("verify");
    expect(h.view.observedState).toMatchObject({
      pending: null,
      error: "unreachable",
    });
    expect(h.eraser.erase).not.toHaveBeenCalled();
    expect(h.page.replace).not.toHaveBeenCalled();
  });
  it("コード確認の応答が90秒上限を過ぎると、遅い成功でも削除を開始しない", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    const response = Promise.withResolvers<CodeVerification>();
    h.authenticator.verifyCode.mockReturnValue(response.promise);
    const running = h.deleteAccount.verifyCode({ code: "123456" }, h.view);
    await h.clock.advanceAsync(90000);
    await running;
    // When
    response.resolve({ kind: "verified" });
    await h.clock.advanceAsync(1);
    // Then
    expect(h.account.delete).not.toHaveBeenCalled();
    expect(h.eraser.erase).not.toHaveBeenCalled();
  });
  it.each([
    ["確認前", 0],
    ["確認応答の後", 1],
  ] as const)(
    "%sの対象確認が90秒上限まで応答しないと、遅い応答で確認も削除も始めない",
    async (_point, verifies) => {
      // Given
      const h = setup();
      await sendOtp(h);
      const response = Promise.withResolvers<CurrentAccountResult>();
      if (verifies === 1)
        h.authenticator.readCurrentAccount.mockResolvedValueOnce(CURRENT);
      h.authenticator.readCurrentAccount.mockReturnValueOnce(response.promise);
      const running = h.deleteAccount.verifyCode({ code: "123456" }, h.view);
      await h.clock.advanceAsync(90000);
      await running;
      // When
      response.resolve(CURRENT);
      await h.clock.advanceAsync(1);
      // Then
      expect(h.authenticator.verifyCode).toHaveBeenCalledTimes(verifies);
      expect(h.account.delete).not.toHaveBeenCalled();
      expect(h.eraser.erase).not.toHaveBeenCalled();
      expect(h.view.observedState.error).toBe("unreachable");
    },
  );
  it("完了のサインアウトが失敗したときは通信エラーを示して操作を戻す", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    h.authenticator.discardHere.mockResolvedValue({
      kind: "failed",
      failure: { kind: "unreachable" },
    });
    // When
    await h.deleteAccount.verifyCode({ code: "123456" }, h.view);
    // Then
    expect(h.eraser.erase).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(h.page.replace).not.toHaveBeenCalled();
    expect(h.view.observedState).toMatchObject({
      pending: null,
      error: "unreachable",
    });
  });
  it("再送待機の計時は1秒後に残り秒数を進める出来事を送る", () => {
    // Given
    const h = setup();
    const dispatch = vi.fn();
    // When
    h.deleteAccount.tickCooldown(dispatch);
    h.clock.advance(1000);
    // Then
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: "cooldownTicked",
    });
  });
});

describe("対象の確認の失敗", () => {
  it("「アカウントを削除」の送信で認証の喪失が分かったときは、送付せず意思確認に留まり、セッションの読み直しへ委ねる", async () => {
    // Given
    const h = setup();
    ready(h);
    h.authenticator.readCurrentAccount.mockResolvedValue({ kind: "lost" });
    // When
    await h.deleteAccount.sendCode(h.view);
    // Then
    expect(h.authenticator.sendCode).not.toHaveBeenCalled();
    expect(h.account.delete).not.toHaveBeenCalled();
    expect(h.authenticator.readSession).toHaveBeenCalledWith({ refresh: true });
    expect(h.view.observedState).toMatchObject({
      step: "confirmation",
      pending: null,
    });
  });
  it.each(["send", "verify"] as const)(
    "%s前の現在の利用者の取得に失敗したときは要求を出さず、その画面に留まって失敗を示す",
    async (operation) => {
      // Given
      const h = setup();
      if (operation === "send") ready(h);
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
      expect(h.account.delete).not.toHaveBeenCalled();
      expect(h.view.observedState).toMatchObject({
        step: operation === "send" ? "confirmation" : "code",
        error: "unreachable",
        pending: null,
      });
    },
  );
  it("確認応答の後の現在の利用者の取得に失敗したときは削除を開始せず、意思確認へ戻ってその他の失敗を示す", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    h.authenticator.readCurrentAccount
      .mockResolvedValueOnce(CURRENT)
      .mockResolvedValueOnce({
        kind: "failed",
        failure: { kind: "unreachable" },
      });
    // When
    await h.deleteAccount.verifyCode({ code: "123456" }, h.view);
    // Then
    expect(h.authenticator.verifyCode).toHaveBeenCalledOnce();
    expect(h.account.delete).not.toHaveBeenCalled();
    expect(h.eraser.erase).not.toHaveBeenCalled();
    expect(h.view.observedState).toMatchObject({
      step: "confirmation",
      error: "other",
      pending: null,
    });
  });
});

describe("コード送付と確認の失敗・オフライン・離脱", () => {
  it("送信間隔などでコード送付が拒否されたときは削除を呼ばず、意思確認に留まってその理由を示す", async () => {
    // Given
    const h = setup();
    ready(h);
    h.authenticator.sendCode.mockResolvedValue({
      kind: "failed",
      failure: { kind: "rate_limited" },
    });
    // When
    await h.deleteAccount.sendCode(h.view);
    // Then
    expect(h.view.observedState).toMatchObject({
      step: "confirmation",
      error: "rate_limited",
      pending: null,
    });
    expect(h.account.delete).not.toHaveBeenCalled();
  });
  it("コード入力での再送が拒否されたときは、コード入力に留まってその理由を示す", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    passResendWait(h);
    h.authenticator.sendCode.mockResolvedValue({
      kind: "failed",
      failure: { kind: "rate_limited" },
    });
    // When
    await h.deleteAccount.sendCode(h.view);
    // Then
    expect(h.view.observedState).toMatchObject({
      step: "code",
      error: "rate_limited",
      pending: null,
    });
    expect(h.account.delete).not.toHaveBeenCalled();
  });
  it("コード入力で再送待機と取り直したチェックの後に再送すると、同じ対象の現在メールへ新しいチェックの結果で送る", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    passResendWait(h);
    // When
    await h.deleteAccount.sendCode(h.view);
    // Then
    expect(h.authenticator.sendCode).toHaveBeenLastCalledWith({
      email: "archer@example.test",
      captchaToken: "resend-check",
      shouldCreateUser: false,
    });
    expect(h.authenticator.sendCode).toHaveBeenCalledTimes(2);
    expect(h.view.observedState).toMatchObject({ step: "code", error: null });
  });
  it.each(["send", "verify"] as const)(
    "オフラインでは%sの対象確認も要求も行わない",
    async (operation) => {
      // Given
      const h = setup();
      if (operation === "send") ready(h);
      if (operation === "verify") await sendOtp(h);
      h.authenticator.readCurrentAccount.mockClear();
      h.connectivity.goOffline();
      // When
      if (operation === "send") await h.deleteAccount.sendCode(h.view);
      if (operation === "verify")
        await h.deleteAccount.verifyCode({ code: "123456" }, h.view);
      // Then
      expect(h.authenticator.readCurrentAccount).not.toHaveBeenCalled();
      expect(h.authenticator.sendCode).toHaveBeenCalledTimes(
        operation === "verify" ? 1 : 0,
      );
      expect(h.authenticator.verifyCode).not.toHaveBeenCalled();
      expect(h.account.delete).not.toHaveBeenCalled();
    },
  );
  it("コード送付の対象確認を待つ間に画面を離れると送付を始めない", async () => {
    // Given
    const h = setup();
    ready(h);
    const response = Promise.withResolvers<CurrentAccountResult>();
    h.authenticator.readCurrentAccount.mockReturnValue(response.promise);
    const running = h.deleteAccount.sendCode(h.view);
    h.screen.mounted = false;
    // When
    response.resolve(CURRENT);
    await running;
    // Then
    expect(h.authenticator.sendCode).not.toHaveBeenCalled();
  });
  it("コード送付の応答を待つ間に画面を離れると遅い応答で段階を進めない", async () => {
    // Given
    const h = setup();
    ready(h);
    const response = Promise.withResolvers<CallResult>();
    h.authenticator.sendCode.mockReturnValue(response.promise);
    const running = h.deleteAccount.sendCode(h.view);
    await vi.waitFor(() => expect(h.authenticator.sendCode).toHaveBeenCalled());
    h.screen.mounted = false;
    // When
    response.resolve({ kind: "accepted" });
    await running;
    // Then
    expect(h.view.observedState.step).toBe("confirmation");
    expect(h.events.map(({ type }) => type)).not.toContain("codeSentTo");
  });
  it("削除応答待ちに離脱しても、成功確認後の消去と終了は進め、表示は更新しない", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    const response = Promise.withResolvers<AccountDeletionResult>();
    h.account.delete.mockReturnValue(response.promise);
    const running = h.deleteAccount.verifyCode({ code: "123456" }, h.view);
    await vi.waitFor(() => expect(h.account.delete).toHaveBeenCalledOnce());
    h.screen.mounted = false;
    const before = h.events.length;
    // When
    response.resolve({ kind: "deleted" });
    await running;
    // Then
    expect(h.events).toHaveLength(before);
    expect(h.eraser.erase).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(h.page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
  });
  it("離脱後に削除が確定失敗しても遅い表示更新を行わず、記録を消さない", async () => {
    // Given
    const h = setup();
    await sendOtp(h);
    const response = Promise.withResolvers<AccountDeletionResult>();
    h.account.delete.mockReturnValue(response.promise);
    const running = h.deleteAccount.verifyCode({ code: "123456" }, h.view);
    await vi.waitFor(() => expect(h.account.delete).toHaveBeenCalledOnce());
    h.screen.mounted = false;
    const before = h.events.length;
    // When
    response.resolve({ kind: "failed" });
    await running;
    // Then
    expect(h.events).toHaveLength(before);
    expect(h.eraser.erase).not.toHaveBeenCalled();
    expect(h.page.replace).not.toHaveBeenCalled();
  });
});
