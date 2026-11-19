import { describe, expect, it } from "vitest";
import {
  beginDeleteAccount,
  beginDeleteCodeSend,
  beginDeleteCodeVerify,
  deleteAccountReducer,
  initialDeleteAccountFlow,
} from "./delete-account-flow";

describe("削除の段階", () => {
  it("意思確認の操作はCAPTCHAなしで処理中になり、段階は意思確認のまま対象の確認を待つ", () => {
    // Given
    // When
    const next = beginDeleteAccount(initialDeleteAccountFlow, {
      offline: false,
    });
    // Then
    expect(next.request).toBe(true);
    expect(next.state).toMatchObject({
      step: "confirmation",
      pending: "delete",
      submitting: true,
    });
  });
  it("コード送信の要求は、取得した対象とメールを保持し、チェックの完了を待つ処理中になる", () => {
    // Given
    const confirming = beginDeleteAccount(initialDeleteAccountFlow, {
      offline: false,
    }).state;
    // When
    const next = deleteAccountReducer(confirming, {
      type: "codeRequested",
      userId: "user-1",
      email: "archer@example.test",
    });
    // Then
    expect(next).toMatchObject({
      userId: "user-1",
      email: "archer@example.test",
      pending: "send",
      submitting: true,
      awaitingCheck: true,
      captchaToken: null,
      error: null,
    });
  });
  it("コード送信の要求の後にチェックが完了すると、その対象とメールとトークンで送付を開始できる", () => {
    // Given
    const requested = deleteAccountReducer(initialDeleteAccountFlow, {
      type: "codeRequested",
      userId: "user-1",
      email: "archer@example.test",
    });
    const checked = deleteAccountReducer(requested, {
      type: "captchaChecked",
      token: "check",
    });
    // When
    const send = beginDeleteCodeSend(checked, false);
    // Then
    expect(send.request).toEqual({
      userId: "user-1",
      email: "archer@example.test",
      captchaToken: "check",
    });
    expect(send.state).toMatchObject({ pending: "send", submitting: true });
  });
  it("送付が受理されると、コード入力へ進み処理中を解く", () => {
    // Given
    const requested = deleteAccountReducer(initialDeleteAccountFlow, {
      type: "codeRequested",
      userId: "user-1",
      email: "archer@example.test",
    });
    // When
    const next = deleteAccountReducer(requested, { type: "codeSent" });
    // Then
    expect(next).toMatchObject({
      step: "code",
      pending: null,
      submitting: false,
      email: "archer@example.test",
    });
  });
  it("意思確認ではコード送付も確認も開始しない", () => {
    // Given
    // When
    const send = beginDeleteCodeSend(initialDeleteAccountFlow, false);
    const verify = beginDeleteCodeVerify(initialDeleteAccountFlow, {
      code: "123456",
      offline: false,
    });
    // Then
    expect(send.request).toBeNull();
    expect(verify.request).toBeNull();
  });
  it("オフラインでは意思確認の操作を開始しない", () => {
    // Given
    // When
    const next = beginDeleteAccount(initialDeleteAccountFlow, {
      offline: true,
    });
    // Then
    expect(next.request).toBeNull();
    expect(next.state.error).toBe("offline");
  });
  it("意思確認の処理中は二重操作を受け付けない", () => {
    // Given
    const running = beginDeleteAccount(initialDeleteAccountFlow, {
      offline: false,
    }).state;
    // When
    const next = beginDeleteAccount(running, { offline: false });
    // Then
    expect(next.request).toBeNull();
    expect(next.state).toBe(running);
  });
  it("確認後の削除がOTP不足のときは、意思確認へ戻り、再確認の案内を持ち、処理中を解く", () => {
    // Given
    const requested = deleteAccountReducer(initialDeleteAccountFlow, {
      type: "codeRequested",
      userId: "user-1",
      email: "archer@example.test",
    });
    const entering = deleteAccountReducer(requested, { type: "codeSent" });
    // When
    const next = deleteAccountReducer(entering, {
      type: "otpRequired",
      userId: "user-1",
      email: "archer@example.test",
    });
    // Then
    expect(next).toMatchObject({
      step: "confirmation",
      pending: null,
      submitting: false,
      error: "otp_required",
    });
  });
  it.each(["unreachable", "other"] as const)(
    "削除が%sで終わると、意思確認へ戻り、その理由を持ち、処理中を解く",
    (kind) => {
      // Given
      const requested = deleteAccountReducer(initialDeleteAccountFlow, {
        type: "codeRequested",
        userId: "user-1",
        email: "archer@example.test",
      });
      const entering = deleteAccountReducer(requested, { type: "codeSent" });
      // When
      const next = deleteAccountReducer(entering, {
        type: "deletionFailed",
        failure: { kind },
      });
      // Then
      expect(next).toMatchObject({
        step: "confirmation",
        pending: null,
        submitting: false,
        error: kind,
      });
    },
  );
  it("送付が拒否されると、意思確認に留まる段階へ戻り、その理由を持ち、処理中を解く", () => {
    // Given
    const requested = deleteAccountReducer(initialDeleteAccountFlow, {
      type: "codeRequested",
      userId: "user-1",
      email: "archer@example.test",
    });
    // When
    const next = deleteAccountReducer(requested, {
      type: "refused",
      failure: { kind: "rate_limited" },
    });
    // Then
    expect(next).toMatchObject({
      step: "confirmation",
      pending: null,
      submitting: false,
      error: "rate_limited",
    });
  });
});
