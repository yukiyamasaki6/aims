import { describe, expect, it } from "vitest";
import {
  beginDeleteCodeSend,
  beginDeleteCodeVerify,
  type DeleteAccountFlow,
  deleteAccountReducer,
  initialDeleteAccountFlow,
} from "./delete-account-flow";

const checked = deleteAccountReducer(initialDeleteAccountFlow, {
  type: "captchaChecked",
  token: "check",
});
const sending = beginDeleteCodeSend(checked, false).state;
const entering = deleteAccountReducer(sending, {
  type: "codeSentTo",
  userId: "user-1",
  email: "archer@example.test",
});
// コード入力で再送待機の60秒が過ぎ、チェックを取り直した状態。
function afterResendWait(flow: DeleteAccountFlow) {
  let next = flow;
  for (let second = 0; second < 60; second += 1)
    next = deleteAccountReducer(next, { type: "cooldownTicked" });
  return deleteAccountReducer(next, {
    type: "captchaChecked",
    token: "resend-check",
  });
}

describe("削除の段階", () => {
  it("初期の段階は意思確認で、対象を持たず処理中でない", () => {
    // Given
    // When
    const flow = initialDeleteAccountFlow;
    // Then
    expect(flow).toMatchObject({
      step: "confirmation",
      userId: null,
      email: "",
      pending: null,
    });
  });
  it("チェックが完了した意思確認での送信は、送付先を入力で受けずに開始し、意思確認のまま処理中になる", () => {
    // Given
    // When
    const send = beginDeleteCodeSend(checked, false);
    // Then
    expect(send.request).toEqual({
      captchaToken: "check",
      known: null,
    });
    expect(send.state).toMatchObject({
      step: "confirmation",
      pending: "send",
    });
  });
  it("チェックが未完了の意思確認での送信は、要求を出さず、意思確認のまま処理中としてチェックを待つ", () => {
    // Given
    // When
    const send = beginDeleteCodeSend(initialDeleteAccountFlow, false);
    // Then
    expect(send.request).toBeNull();
    expect(send.state).toMatchObject({
      step: "confirmation",
      awaitingCheck: true,
      pending: "send",
    });
  });
  it("送付が受理されると、対象とメールを持ってコード入力へ進み、処理中を解いて60秒の再送待機を始める", () => {
    // Given
    // When
    const next = deleteAccountReducer(sending, {
      type: "codeSentTo",
      userId: "user-1",
      email: "archer@example.test",
    });
    // Then
    expect(next).toMatchObject({
      step: "code",
      userId: "user-1",
      email: "archer@example.test",
      pending: null,
      resendCooldown: 60,
      error: null,
    });
  });
  it("コード入力での確認は、対象とメールとコードで開始し、コード入力のまま処理中になる", () => {
    // Given
    // When
    const verify = beginDeleteCodeVerify(entering, {
      code: "123456",
      offline: false,
    });
    // Then
    expect(verify.request).toEqual({
      userId: "user-1",
      email: "archer@example.test",
      code: "123456",
    });
    expect(verify.state).toMatchObject({
      step: "code",
      pending: "verify",
    });
  });
  it("再送待機の60秒とチェックの取り直しの後の再送は、送付済みの対象とメールで開始する", () => {
    // Given
    const waited = afterResendWait(entering);
    // When
    const send = beginDeleteCodeSend(waited, false);
    // Then
    expect(send.request).toEqual({
      captchaToken: "resend-check",
      known: { userId: "user-1", email: "archer@example.test" },
    });
    expect(send.state).toMatchObject({ step: "code", pending: "send" });
  });
  it("再送が受理されると、コード入力のまま対象を保ち、再送待機を60秒から始め直す", () => {
    // Given
    const resending = beginDeleteCodeSend(afterResendWait(entering), false);
    // When
    const next = deleteAccountReducer(resending.state, {
      type: "codeSentTo",
      userId: "user-1",
      email: "archer@example.test",
    });
    // Then
    expect(next).toMatchObject({
      step: "code",
      userId: "user-1",
      resendCooldown: 60,
      pending: null,
    });
  });
  it("意思確認ではコードの確認を開始しない", () => {
    // Given
    // When
    const verify = beginDeleteCodeVerify(checked, {
      code: "123456",
      offline: false,
    });
    // Then
    expect(verify.request).toBeNull();
    expect(verify.state).toBe(checked);
  });
  it("オフラインでは送信を開始せず、意思確認のままオフラインの理由を持つ", () => {
    // Given
    // When
    const send = beginDeleteCodeSend(checked, true);
    // Then
    expect(send.request).toBeNull();
    expect(send.state).toMatchObject({
      step: "confirmation",
      error: "offline",
      pending: null,
    });
  });
  it("送信の処理中は二重の送信を受け付けない", () => {
    // Given
    // When
    const next = beginDeleteCodeSend(sending, false);
    // Then
    expect(next.request).toBeNull();
    expect(next.state).toMatchObject({ pending: "send" });
  });
  it("再送待機の60秒が過ぎる前の再送は開始せず、コード入力のまま再送の不備を持つ", () => {
    // Given
    const early = deleteAccountReducer(entering, {
      type: "captchaChecked",
      token: "resend-check",
    });
    // When
    const send = beginDeleteCodeSend(early, false);
    // Then
    expect(send.request).toBeNull();
    expect(send.state.step).toBe("code");
    expect(send.state.fieldErrors.resend).toBeDefined();
  });
  it.each(["refused", "failed"] as const)(
    "意思確認での送信が%sで終わると、意思確認に留まり、その理由を持ち、処理中を解く",
    (type) => {
      // Given
      // When
      const next = deleteAccountReducer(sending, {
        type,
        failure: { kind: "rate_limited" },
      });
      // Then
      expect(next).toMatchObject({
        step: "confirmation",
        userId: null,
        pending: null,
        error: "rate_limited",
      });
    },
  );
  it.each(["code_expired", "rate_limited", "unreachable"] as const)(
    "コード入力でのコード確認が%sで終わると、意思確認へ戻らずコード入力に留まり、その理由を持ち、処理中を解く",
    (kind) => {
      // Given
      const verifying = beginDeleteCodeVerify(entering, {
        code: "123456",
        offline: false,
      }).state;
      // When
      const next = deleteAccountReducer(verifying, {
        type: "failed",
        failure: { kind },
      });
      // Then
      expect(next).toMatchObject({
        step: "code",
        userId: "user-1",
        email: "archer@example.test",
        pending: null,
        error: kind,
      });
    },
  );
  it("コード入力から戻ると、意思確認へ戻り、チェックのトークンとエラーを消し、対象とメールと再送待機を保つ", () => {
    // Given
    const verifying = beginDeleteCodeVerify(entering, {
      code: "123456",
      offline: false,
    }).state;
    const failed = deleteAccountReducer(
      deleteAccountReducer(verifying, {
        type: "failed",
        failure: { kind: "code_expired" },
      }),
      { type: "captchaChecked", token: "resend-check" },
    );
    // When
    const next = deleteAccountReducer(failed, { type: "emailStepReturned" });
    // Then
    expect(next).toMatchObject({
      step: "confirmation",
      captchaToken: null,
      error: null,
      fieldErrors: {},
      userId: "user-1",
      email: "archer@example.test",
      resendCooldown: 60,
      pending: null,
    });
  });
  it("確認の処理中は戻る操作を受け付けず、コード入力のまま状態を変えない", () => {
    // Given
    const verifying = beginDeleteCodeVerify(entering, {
      code: "123456",
      offline: false,
    }).state;
    // When
    const next = deleteAccountReducer(verifying, { type: "emailStepReturned" });
    // Then
    expect(next).toEqual(verifying);
  });
  it("再送待機中に戻った意思確認での送信は開始せず、意思確認のまま再送待機の不備を持ち、待機が過ぎると送付済みの対象で開始できる", () => {
    // Given
    const returned = deleteAccountReducer(entering, {
      type: "emailStepReturned",
    });
    // When
    const early = beginDeleteCodeSend(
      deleteAccountReducer(returned, {
        type: "captchaChecked",
        token: "resend-check",
      }),
      false,
    );
    const late = beginDeleteCodeSend(afterResendWait(returned), false);
    // Then
    expect(early.request).toBeNull();
    expect(early.state).toMatchObject({
      step: "confirmation",
      pending: null,
    });
    expect(early.state.fieldErrors.resend).toBeDefined();
    expect(late.request).toEqual({
      captchaToken: "resend-check",
      known: { userId: "user-1", email: "archer@example.test" },
    });
    expect(late.state).toMatchObject({ step: "confirmation", pending: "send" });
  });
  it("確認に成功した後の失敗では、処理中でも意思確認へ戻り、その他の失敗を持ち、処理中を解き、トークンを破棄し、対象とメールと再送待機を保つ", () => {
    // Given
    const verifying = beginDeleteCodeVerify(
      deleteAccountReducer(entering, {
        type: "captchaChecked",
        token: "resend-check",
      }),
      { code: "123456", offline: false },
    ).state;
    // When
    const next = deleteAccountReducer(verifying, {
      type: "returnedWithFailure",
    });
    // Then
    expect(next).toMatchObject({
      step: "confirmation",
      error: "other",
      pending: null,
      captchaToken: null,
      userId: "user-1",
      email: "archer@example.test",
      resendCooldown: 60,
    });
  });
});
