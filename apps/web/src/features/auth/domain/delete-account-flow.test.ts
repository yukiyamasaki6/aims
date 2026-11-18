import { describe, expect, it } from "vitest";
import type { AuthFailureKind } from "./auth-failure";
import {
  beginDeleteAccount,
  type DeleteAccountFlow,
  deleteAccountReducer,
  initialDeleteAccountFlow,
} from "./delete-account-flow";

const checked: DeleteAccountFlow = {
  ...initialDeleteAccountFlow,
  captchaToken: "token-1",
};
const validInput = { password: "password-current1", offline: false };

describe("beginDeleteAccount", () => {
  it("パスワードを入力し、チェックが済み、オンラインなら、送信中にして、パスワードとトークンを頼む", () => {
    // Given
    // When
    const result = beginDeleteAccount(checked, validInput);

    // Then
    expect(result.request).toEqual({
      password: "password-current1",
      captchaToken: "token-1",
    });
    expect(result.state).toMatchObject({
      submitting: true,
      error: null,
      fieldErrors: {},
    });
  });

  it("開始すると、以前のエラーを消す", () => {
    // Given
    const failed = { ...checked, error: "other" as const };

    // When
    const result = beginDeleteAccount(failed, validInput);

    // Then
    expect(result.state.error).toBeNull();
  });

  it("送信中は、他の条件に依らず開始せず、状態を変えない", () => {
    // Given
    const submitting = { ...checked, submitting: true };

    // When
    const valid = beginDeleteAccount(submitting, validInput);
    const invalid = beginDeleteAccount(
      { ...initialDeleteAccountFlow, submitting: true },
      { password: "", offline: true },
    );

    // Then
    expect(valid.request).toBeNull();
    expect(valid.state).toBe(submitting);
    expect(invalid.request).toBeNull();
    expect(invalid.state.fieldErrors).toEqual({});
    expect(invalid.state.error).toBeNull();
  });

  it("パスワードが未入力なら、理由を示して開始しない", () => {
    // Given
    // When
    const result = beginDeleteAccount(checked, {
      password: "",
      offline: false,
    });

    // Then
    expect(result.request).toBeNull();
    expect(result.state.fieldErrors).toEqual({ currentPassword: "required" });
    expect(result.state.submitting).toBe(false);
  });

  it("空文字は未入力として開始せず、空白1文字は入力として開始する(空白だけの入力は認証サービスの照合に任せる)", () => {
    // Given
    // When
    const empty = beginDeleteAccount(checked, { password: "", offline: false });
    const blank = beginDeleteAccount(checked, {
      password: " ",
      offline: false,
    });

    // Then
    expect(empty.request).toBeNull();
    expect(blank.request).toEqual({ password: " ", captchaToken: "token-1" });
  });

  it("チェックが済んでいなければ、依頼を返さず、送信中の待ちにする", () => {
    // Given
    // When
    const result = beginDeleteAccount(initialDeleteAccountFlow, validInput);

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toMatchObject({
      submitting: true,
      awaitingCheck: true,
      fieldErrors: {},
      error: null,
    });
  });

  it("失敗の通知で待ちが解けた後に押すと、すぐには失敗を示さず、通常どおり待ちにする", () => {
    // Given
    const waiting = beginDeleteAccount(
      initialDeleteAccountFlow,
      validInput,
    ).state;
    const released = deleteAccountReducer(waiting, {
      type: "checkWaitReleased",
    });

    // When
    const result = beginDeleteAccount(released, validInput);

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toMatchObject({
      submitting: true,
      awaitingCheck: true,
      error: null,
    });
    expect(result.state.fieldErrors.captcha).toBeUndefined();
  });

  it("未入力なら、チェックの状態によらず、未入力だけを示す", () => {
    // Given
    // When
    const result = beginDeleteAccount(initialDeleteAccountFlow, {
      password: "",
      offline: false,
    });

    // Then
    expect(result.request).toBeNull();
    expect(result.state.fieldErrors).toEqual({ currentPassword: "required" });
  });

  it("オフラインなら、開始せず、オフラインを示す(チェックを待たず、チェックのエラーも示さない)", () => {
    // Given
    // When
    const result = beginDeleteAccount(initialDeleteAccountFlow, {
      password: "password-current1",
      offline: true,
    });

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toMatchObject({
      error: "offline",
      fieldErrors: {},
      submitting: false,
    });
  });

  it("オフラインでも、パスワードが未入力なら、オフラインより先に未入力を示す", () => {
    // Given
    // When
    const result = beginDeleteAccount(checked, { password: "", offline: true });

    // Then
    expect(result.request).toBeNull();
    expect(result.state.error).toBeNull();
    expect(result.state.fieldErrors).toEqual({ currentPassword: "required" });
  });
});

describe("deleteAccountReducer", () => {
  it("チェックの完了で、トークンを持つ", () => {
    // Given
    // When
    const next = deleteAccountReducer(initialDeleteAccountFlow, {
      type: "captchaChecked",
      token: "token-2",
    });

    // Then
    expect(next.captchaToken).toBe("token-2");
  });

  it("チェックの失効(トークンなし)で、トークンを手放す", () => {
    // Given
    // When
    const next = deleteAccountReducer(checked, {
      type: "captchaChecked",
      token: null,
    });

    // Then
    expect(next.captchaToken).toBeNull();
  });

  it.each<AuthFailureKind>([
    "current_password_invalid",
    "rate_limited",
    "captcha_failed",
    "unreachable",
    "other",
  ])(
    "%sで失敗すると、送信中を終え、その理由を示し、チェックを未完了に戻す",
    (kind) => {
      // Given
      const submitting = { ...checked, submitting: true };

      // When
      const next = deleteAccountReducer(submitting, {
        type: "failed",
        failure: { kind },
      });

      // Then
      expect(next).toMatchObject({
        submitting: false,
        error: kind,
        captchaToken: null,
      });
    },
  );
});

describe("deleteAccountReducer: セキュリティチェックの待ち", () => {
  const waiting = beginDeleteAccount(
    initialDeleteAccountFlow,
    validInput,
  ).state;

  it("待ちの間、トークンが無い再押下では何も変えず、届いた後の開始では依頼を返す", () => {
    // Given
    const arrived = deleteAccountReducer(waiting, {
      type: "captchaChecked",
      token: "token-2",
    });

    // When
    const again = beginDeleteAccount(waiting, validInput);
    const resumed = beginDeleteAccount(arrived, validInput);

    // Then
    expect(again.state).toBe(waiting);
    expect(resumed.request).toEqual({
      password: "password-current1",
      captchaToken: "token-2",
    });
    expect(resumed.state).toMatchObject({
      submitting: true,
      awaitingCheck: false,
    });
  });

  it("待ちを解く事実は、待ちを解いて送信中を終え、チェックのエラーを示す", () => {
    // Given

    // When
    const result = deleteAccountReducer(waiting, { type: "checkWaitReleased" });

    // Then
    expect(result).toMatchObject({
      submitting: false,
      awaitingCheck: false,
      fieldErrors: { captcha: "incomplete" },
    });
  });
});
