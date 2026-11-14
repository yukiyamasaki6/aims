import { describe, expect, it } from "vitest";
import {
  beginChangePassword,
  type ChangePasswordFlow,
  changePasswordReducer,
  initialChangePasswordFlow,
} from "./change-password-flow";

const validInput = {
  currentPassword: "password-original1",
  newPassword: "password-changed1",
  offline: false,
};

function flowWith(overrides: Partial<ChangePasswordFlow>): ChangePasswordFlow {
  return { ...initialChangePasswordFlow, ...overrides };
}

describe("beginChangePassword", () => {
  it("入力が有効でオンラインなら、送信中にして、現在と新しいパスワードを頼む", () => {
    // Given

    // When
    const result = beginChangePassword(initialChangePasswordFlow, validInput);

    // Then
    expect(result.request).toEqual({
      currentPassword: validInput.currentPassword,
      newPassword: validInput.newPassword,
    });
    expect(result.state).toMatchObject({
      submitting: true,
      error: null,
      fieldErrors: {},
    });
  });

  it("送信中は入力に不備があってもbusyを返し、状態を変えない", () => {
    // Given
    const submitting = flowWith({ submitting: true });

    // When
    const valid = beginChangePassword(submitting, validInput);
    const invalid = beginChangePassword(submitting, {
      currentPassword: "",
      newPassword: "",
      offline: true,
    });

    // Then
    expect(valid.state).toBe(submitting);
    expect(valid.request).toBeNull();
    expect(invalid.state).toBe(submitting);
    expect(invalid.request).toBeNull();
  });

  it.each([
    [
      "現在も新しいも未入力なら、2つとも",
      { currentPassword: "", newPassword: "" },
      { currentPassword: "required", newPassword: "required" },
    ],
    [
      "新しいパスワードに全角を含むなら、新しいパスワードの規則の誤りだけ",
      { currentPassword: "password-original1", newPassword: "ｐａｓｓ１" },
      { newPassword: "invalidRule" },
    ],
    [
      "現在が未入力で新しいに全角を含むなら、その2つ",
      { currentPassword: "", newPassword: "パスワード1" },
      { currentPassword: "required", newPassword: "invalidRule" },
    ],
    [
      "現在が未入力で新しいが短いなら、未入力だけ(短さは認証サービスが判定する)",
      { currentPassword: "", newPassword: "abc1" },
      { currentPassword: "required" },
    ],
  ])("入力不備では、%s示して開始しない", (_name, input, fieldErrors) => {
    // Given

    // When
    const result = beginChangePassword(initialChangePasswordFlow, {
      ...input,
      offline: false,
    });

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toMatchObject({
      submitting: false,
      error: null,
      fieldErrors,
    });
  });

  // 旧い規則で登録した既存のパスワードで変更できるよう、規則は課さない(値そのものが検証の対象)。
  it.each(["a", "a".repeat(73), "パスワード", " "])(
    "現在のパスワード %s は、空でなければ長さや文字種によらず受け付ける",
    (currentPassword) => {
      // Given

      // When
      const result = beginChangePassword(initialChangePasswordFlow, {
        ...validInput,
        currentPassword,
      });

      // Then
      expect(result.request).not.toBeNull();
    },
  );

  // 新しいパスワードの長さと強さは、認証サービスの拒否に任せる(値そのものが検証の対象)。
  it.each(["abc1", "onlyletters", "a".repeat(73)])(
    "新しいパスワード %s は、半角英数記号のみなら長さや強さによらず送る",
    (newPassword) => {
      // Given

      // When
      const result = beginChangePassword(initialChangePasswordFlow, {
        ...validInput,
        newPassword,
      });

      // Then
      expect(result.request).not.toBeNull();
    },
  );

  it("入力に不備が無くオフラインなら、offlineを示して送らず、送信中にしない", () => {
    // Given

    // When
    const result = beginChangePassword(initialChangePasswordFlow, {
      ...validInput,
      offline: true,
    });

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toMatchObject({
      submitting: false,
      error: "offline",
      fieldErrors: {},
    });
  });

  it("入力に不備がありオフラインなら、その不備だけを示し、offlineは示さない", () => {
    // Given

    // When
    const result = beginChangePassword(initialChangePasswordFlow, {
      currentPassword: "",
      newPassword: "password-changed1",
      offline: true,
    });

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toMatchObject({
      error: null,
      fieldErrors: { currentPassword: "required" },
    });
  });

  it("前回のoffline表示は、オンラインでの再送信の開始で消える", () => {
    // Given
    const offline = beginChangePassword(initialChangePasswordFlow, {
      ...validInput,
      offline: true,
    }).state;

    // When
    const result = beginChangePassword(offline, validInput);

    // Then
    expect(result.request).not.toBeNull();
    expect(result.state.error).toBeNull();
  });

  it("開始できるときは、前回のエラーと欄のエラーと完了の表示を消して送信中にする", () => {
    // Given
    const flow = flowWith({
      error: "current_password_invalid",
      fieldErrors: { newPassword: "required" },
      completed: true,
    });

    // When
    const result = beginChangePassword(flow, validInput);

    // Then
    expect(result.state).toMatchObject({
      submitting: true,
      error: null,
      fieldErrors: {},
      completed: false,
    });
  });

  it("入力に不備があるときは、前回の欄のエラーを差し替え、前回のエラーと完了の表示を消す", () => {
    // Given
    const flow = flowWith({
      error: "other",
      fieldErrors: { newPassword: "invalidRule" },
      completed: true,
    });

    // When
    const result = beginChangePassword(flow, {
      ...validInput,
      currentPassword: "",
    });

    // Then
    expect(result.state).toMatchObject({
      submitting: false,
      error: null,
      fieldErrors: { currentPassword: "required" },
      completed: false,
    });
  });
});

describe("changePasswordReducer", () => {
  it("変更が受け付けられたら、完了にして送信中を解く", () => {
    // Given
    const flow = flowWith({ submitting: true });

    // When
    const next = changePasswordReducer(flow, { type: "changed" });

    // Then
    expect(next).toMatchObject({
      submitting: false,
      completed: true,
      error: null,
    });
  });

  it.each([
    "current_password_invalid",
    "same_password",
    "weak_password",
    "rate_limited",
    "unreachable",
    "other",
  ] as const)(
    "%sで失敗したら、種類を保ち、送信中を解いて完了にしない",
    (kind) => {
      // Given
      const flow = flowWith({ submitting: true });

      // When
      const next = changePasswordReducer(flow, {
        type: "failed",
        failure: { kind },
      });

      // Then
      expect(next).toMatchObject({
        submitting: false,
        completed: false,
        error: kind,
      });
    },
  );

  it("失敗の後は、再び開始できる", () => {
    // Given
    const failed = changePasswordReducer(
      beginChangePassword(initialChangePasswordFlow, validInput).state,
      { type: "failed", failure: { kind: "current_password_invalid" } },
    );

    // When
    const result = beginChangePassword(failed, validInput);

    // Then
    expect(result.request).not.toBeNull();
  });

  it("完了の後も、再び開始できる", () => {
    // Given
    const completed = changePasswordReducer(
      beginChangePassword(initialChangePasswordFlow, validInput).state,
      { type: "changed" },
    );

    // When
    const result = beginChangePassword(completed, validInput);

    // Then
    expect(result.request).not.toBeNull();
    expect(result.state.completed).toBe(false);
  });
});
