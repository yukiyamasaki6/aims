import { describe, expect, it } from "vitest";
import type { AuthFailureKind } from "./auth-failure";
import {
  beginConfirmEmailChange,
  beginRequestEmailChange,
  beginResendEmailChangeCode,
  type ChangeEmailEvent,
  type ChangeEmailFlow,
  type CodeField,
  changeEmailReducer,
  initialChangeEmailFlow,
} from "./change-email-flow";

const currentEmail = "current@example.com";
const newEmail = "new@example.com";
const noCodes = { currentCode: null, newCode: null };

function flowWith(overrides: Partial<ChangeEmailFlow>): ChangeEmailFlow {
  return { ...initialChangeEmailFlow, ...overrides };
}

// コード確認の段階。再送の待ちは明けていて、チェックのトークンがある。
const onCodeStep = flowWith({
  step: "code",
  currentEmail,
  newEmail,
  captchaToken: "token",
  resendCooldown: 0,
});

// 欄が確認できたコードを持つ、コード確認の段階。
function confirmedOf(field: CodeField, code = "111111"): ChangeEmailFlow {
  return flowWith({
    ...onCodeStep,
    confirmedCodes: { ...noCodes, [field]: code },
  });
}

function confirmedEvent(
  overrides: Partial<Extract<ChangeEmailEvent, { type: "confirmed" }>>,
): ChangeEmailEvent {
  return {
    type: "confirmed",
    confirmed: [],
    expired: [],
    completed: false,
    failure: null,
    ...overrides,
  };
}

const pendingOf = (pending: ChangeEmailFlow["pending"]) =>
  flowWith({ ...onCodeStep, pending });

describe("beginRequestEmailChange", () => {
  it("有効な新しいメールアドレスでオンラインなら、要求を実行中にし、前回のエラー・欄のエラーを消す", () => {
    // Given
    const before = flowWith({
      error: "other",
      fieldErrors: { email: "required" },
    });

    // When
    const result = beginRequestEmailChange(before, {
      email: newEmail,
      offline: false,
    });

    // Then
    expect(result.request).toEqual({ newEmail });
    expect(result.state).toMatchObject({
      pending: "request",
      error: null,
      fieldErrors: {},
    });
  });

  it.each([
    ["未入力", "", "required"],
    ["形式不正", "not-an-email", "invalidFormat"],
  ] as const)(
    "新しいメールアドレスが%sなら、欄のエラーを示して開始しない",
    (_name, email, kind) => {
      // Given

      // When
      const result = beginRequestEmailChange(initialChangeEmailFlow, {
        email,
        offline: false,
      });

      // Then
      expect(result.request).toBeNull();
      expect(result.state.fieldErrors).toEqual({ email: kind });
      expect(result.state.pending).toBeNull();
    },
  );

  it("入力の不備とオフラインが重なると、入力の不備だけを示し、offlineは示さない", () => {
    // Given

    // When
    const result = beginRequestEmailChange(initialChangeEmailFlow, {
      email: "not-an-email",
      offline: true,
    });

    // Then
    expect(result.request).toBeNull();
    expect(result.state.fieldErrors).toEqual({ email: "invalidFormat" });
    expect(result.state.error).toBeNull();
  });

  it("有効な入力でもオフラインなら、offlineを示し、実行中にしない", () => {
    // Given

    // When
    const result = beginRequestEmailChange(initialChangeEmailFlow, {
      email: newEmail,
      offline: true,
    });

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toMatchObject({ error: "offline", pending: null });
  });
});

describe("実行中の開始の拒否", () => {
  it.each<ChangeEmailFlow["pending"]>(["request", "confirm", "resend"])(
    "%sの実行中は、入力に不備があっても3つの命令のどれも開始せず、状態を変えない",
    (pending) => {
      // Given
      const running = flowWith({ ...pendingOf(pending), resendCooldown: 30 });

      // When
      const requested = beginRequestEmailChange(running, {
        email: "",
        offline: true,
      });
      const confirmed = beginConfirmEmailChange(running, {
        codes: { currentCode: "", newCode: "" },
        offline: true,
      });
      const resent = beginResendEmailChangeCode(running, { offline: true });

      // Then
      for (const result of [requested, confirmed, resent]) {
        expect(result.request).toBeNull();
        expect(result.state).toBe(running);
      }
    },
  );
});

describe("changeEmailReducer の要求の受け付け", () => {
  it("要求の受け付けでコード確認の段階になり、再送の待ちが60秒で始まり、両方のメールアドレスを持ち、実行中を解く", () => {
    // Given
    const requesting = flowWith({
      pending: "request",
      captchaToken: "stale",
      currentEmail: "stale@example.com",
    });

    // When
    const next = changeEmailReducer(requesting, {
      type: "requested",
      currentEmail,
      newEmail,
    });

    // Then
    expect(next).toMatchObject({
      step: "code",
      currentEmail,
      newEmail,
      confirmedCodes: noCodes,
      resendCooldown: 60,
      generation: 1,
      pending: null,
    });
  });

  it("戻ってから要求しなおしても、前回の確認できたコードは引き継がれない", () => {
    // Given
    const half = confirmedOf("newCode");
    const backed = changeEmailReducer(half, { type: "backed" });
    const requesting = flowWith({ ...backed, pending: "request" });

    // When
    const next = changeEmailReducer(requesting, {
      type: "requested",
      currentEmail,
      newEmail,
    });

    // Then
    expect(next.confirmedCodes).toEqual(noCodes);
  });
});

describe("beginConfirmEmailChange", () => {
  const codes = { currentCode: "111111", newCode: "222222" };

  it("2欄とも呼ぶときは、確認を実行中にし、入力の順序によらず変更前、変更後の順に、その欄のメールアドレスとコードを頼む", () => {
    // Given

    // When
    const result = beginConfirmEmailChange(onCodeStep, {
      codes: { newCode: "222222", currentCode: "111111" },
      offline: false,
    });

    // Then
    expect(result.request).toEqual([
      { field: "currentCode", email: currentEmail, code: "111111" },
      { field: "newCode", email: newEmail, code: "222222" },
    ]);
    expect(result.state.pending).toBe("confirm");
  });

  it.each<[string, CodeField, CodeField, string]>([
    ["変更前", "currentCode", "newCode", newEmail],
    ["変更後", "newCode", "currentCode", currentEmail],
  ])(
    "%sが確認できたコードを持ち、同じ値を入力したときは、その欄を呼ばず、もう一方の1欄だけを頼む",
    (_name, done, rest, email) => {
      // Given
      const flow = confirmedOf(done, codes[done]);

      // When
      const result = beginConfirmEmailChange(flow, { codes, offline: false });

      // Then
      expect(result.request).toEqual([
        { field: rest, email, code: codes[rest] },
      ]);
    },
  );

  it("確認できたコードを持つ欄の値を変えたときは、新しい入力として2欄とも呼ぶ", () => {
    // Given
    const flow = confirmedOf("newCode", "222222");

    // When
    const result = beginConfirmEmailChange(flow, {
      codes: { currentCode: "111111", newCode: "333333" },
      offline: false,
    });

    // Then
    expect(result.request).toEqual([
      { field: "currentCode", email: currentEmail, code: "111111" },
      { field: "newCode", email: newEmail, code: "333333" },
    ]);
  });

  it.each<
    [string, ChangeEmailFlow, { currentCode: string; newCode: string }, object]
  >([
    [
      "両方が未入力",
      onCodeStep,
      { currentCode: "", newCode: "" },
      { currentCode: "required", newCode: "required" },
    ],
    [
      "変更前だけが未入力",
      onCodeStep,
      { currentCode: "", newCode: "222222" },
      { currentCode: "required" },
    ],
    [
      "変更後だけが未入力",
      onCodeStep,
      { currentCode: "111111", newCode: "" },
      { newCode: "required" },
    ],
    [
      "確認できた欄を空にし、もう一方は入力済み",
      confirmedOf("currentCode"),
      { currentCode: "", newCode: "222222" },
      { currentCode: "required" },
    ],
  ])(
    "%sなら、未入力の欄ごとにエラーを示し、どの欄も頼まない",
    (_name, flow, input, fieldErrors) => {
      // Given

      // When
      const result = beginConfirmEmailChange(flow, {
        codes: input,
        offline: false,
      });

      // Then
      expect(result.request).toBeNull();
      expect(result.state.fieldErrors).toEqual(fieldErrors);
      expect(result.state.pending).toBeNull();
    },
  );

  it("コード入力済みでもオフラインなら、offlineを示し、開始しない", () => {
    // Given

    // When
    const result = beginConfirmEmailChange(onCodeStep, {
      codes,
      offline: true,
    });

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toMatchObject({ error: "offline", pending: null });
  });

  it.each([
    [
      "呼ぶ欄が無い(2欄とも確認できたコードと同じ値)",
      flowWith({
        ...onCodeStep,
        confirmedCodes: { currentCode: "111111", newCode: "222222" },
      }),
    ],
    [
      "現在のメールアドレスを持たない",
      flowWith({ ...onCodeStep, currentEmail: null }),
    ],
    [
      "新しいメールアドレスを持たない",
      flowWith({ ...onCodeStep, newEmail: null }),
    ],
  ])("%sときは、確認を開始せず、状態を変えない", (_name, flow) => {
    // Given

    // When
    const result = beginConfirmEmailChange(flow, { codes, offline: false });

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toBe(flow);
  });
});

describe("changeEmailReducer の確認の結果", () => {
  it("一方だけ確認できたときは、そのコードを持ち、誤りだった欄にだけ誤りの欄エラーが出て、全体のエラーは無く、実行中を解く", () => {
    // Given
    const confirming = pendingOf("confirm");

    // When
    const next = changeEmailReducer(
      confirming,
      confirmedEvent({
        confirmed: [{ field: "newCode", code: "222222" }],
        expired: ["currentCode"],
      }),
    );

    // Then
    expect(next).toMatchObject({
      step: "code",
      confirmedCodes: { currentCode: null, newCode: "222222" },
      fieldErrors: { currentCode: "expiredOrInvalid" },
      error: null,
      pending: null,
    });
    expect(next.fieldErrors.newCode).toBeUndefined();
  });

  it("両方が誤りまたは期限切れだったときは、両方の欄に誤りの欄エラーが出て、全体のエラーは無く、確認できたコードは増えない", () => {
    // Given
    const confirming = pendingOf("confirm");

    // When
    const next = changeEmailReducer(
      confirming,
      confirmedEvent({ expired: ["currentCode", "newCode"] }),
    );

    // Then
    expect(next).toMatchObject({
      confirmedCodes: noCodes,
      fieldErrors: {
        currentCode: "expiredOrInvalid",
        newCode: "expiredOrInvalid",
      },
      error: null,
      pending: null,
    });
  });

  it("変えた値が誤りでも、確認できたコードは残り、次の確認ではその欄を呼ばない", () => {
    // Given
    const confirming = flowWith({
      ...pendingOf("confirm"),
      confirmedCodes: { currentCode: null, newCode: "222222" },
    });

    // When
    const next = changeEmailReducer(
      confirming,
      confirmedEvent({ expired: ["currentCode"] }),
    );
    const retry = beginConfirmEmailChange(next, {
      codes: { currentCode: "333333", newCode: "222222" },
      offline: false,
    });

    // Then
    expect(next.confirmedCodes).toEqual({
      currentCode: null,
      newCode: "222222",
    });
    expect(retry.request?.map((item) => item.field)).toEqual(["currentCode"]);
  });

  it.each<AuthFailureKind>(["rate_limited", "unreachable", "other"])(
    "コードに紐づかない失敗(%s)は、全体のエラーに出て、欄エラーは無く、確認できたコードは維持され、実行中を解く",
    (kind) => {
      // Given
      const confirming = flowWith({
        ...pendingOf("confirm"),
        confirmedCodes: { currentCode: "111111", newCode: null },
      });

      // When
      const next = changeEmailReducer(
        confirming,
        confirmedEvent({ failure: { kind } }),
      );

      // Then
      expect(next).toMatchObject({
        step: "code",
        error: kind,
        fieldErrors: {},
        confirmedCodes: { currentCode: "111111", newCode: null },
        pending: null,
      });
    },
  );

  it.each([
    ["確認できたコードなし", noCodes],
    ["一方が確認できたコードを持つ", { currentCode: "111111", newCode: null }],
  ])(
    "完了では(%s)、完了が真の終わりの状態になり、再送の待ちを止め、チェックのトークンを消し、実行中を解き、失敗も欄エラーも示さない",
    (_name, confirmedCodes) => {
      // Given
      const confirming = flowWith({
        ...pendingOf("confirm"),
        confirmedCodes,
        resendCooldown: 30,
        captchaToken: "token",
      });

      // When
      const next = changeEmailReducer(
        confirming,
        confirmedEvent({
          confirmed: [{ field: "newCode", code: "222222" }],
          completed: true,
          failure: { kind: "other" },
        }),
      );

      // Then
      expect(next).toMatchObject({
        completed: true,
        resendCooldown: 0,
        captchaToken: null,
        pending: null,
        error: null,
        fieldErrors: {},
      });
    },
  );

  it.each([
    [
      "一方だけ確認できた後",
      confirmedEvent({
        confirmed: [{ field: "currentCode", code: "111111" }],
        expired: ["newCode"],
      }),
    ],
    [
      "コードに紐づかない失敗の後",
      confirmedEvent({ failure: { kind: "rate_limited" } }),
    ],
  ])(
    "%sでも、確認を再び開始でき、前回のエラー(全体・欄)は消え、確認できたコードと同じ値の欄は呼ばれない",
    (_name, event) => {
      // Given
      const failed = changeEmailReducer(pendingOf("confirm"), event);

      // When
      const result = beginConfirmEmailChange(failed, {
        codes: { currentCode: "111111", newCode: "222222" },
        offline: false,
      });

      // Then
      expect(result.state).toMatchObject({ error: null, fieldErrors: {} });
      expect(result.request?.map((item) => item.field)).toEqual(
        failed.confirmedCodes.currentCode
          ? ["newCode"]
          : ["currentCode", "newCode"],
      );
    },
  );
});

describe("changeEmailReducer の要求の失敗", () => {
  it.each<AuthFailureKind>([
    "email_exists",
    "same_email",
    "rate_limited",
    "unreachable",
    "other",
  ])(
    "要求の失敗(%s)は、入力の段階のまま、種類をエラーに残し、実行中を解く",
    (kind) => {
      // Given
      const requesting = flowWith({ pending: "request", currentEmail });

      // When
      const next = changeEmailReducer(requesting, {
        type: "failed",
        failure: { kind },
      });

      // Then
      expect(next).toMatchObject({
        step: "email",
        error: kind,
        pending: null,
        currentEmail,
      });
    },
  );
});

describe("beginResendEmailChangeCode", () => {
  it("待ちが明けてトークンがあるオンラインなら、現在のメールアドレスとトークンで頼み、再送を実行中にする", () => {
    // Given

    // When
    const result = beginResendEmailChangeCode(onCodeStep, { offline: false });

    // Then
    expect(result.request).toEqual({
      email: currentEmail,
      captchaToken: "token",
    });
    expect(result.state.pending).toBe("resend");
  });

  it.each([
    [
      "待ち中でトークンありは、待機だけ",
      { resendCooldown: 30 },
      false,
      { resend: "cooldown" },
      null,
    ],
    [
      "待ち中でトークン無しのオンラインは、チェックが待ちなら待機だけ",
      { resendCooldown: 30, captchaToken: null },
      false,
      { resend: "cooldown" },
      null,
    ],
    [
      "待ち中のオフラインは、待機だけ(チェック未完了は示さない)",
      { resendCooldown: 30, captchaToken: null },
      true,
      { resend: "cooldown" },
      null,
    ],
    [
      "待ちが明けたオフラインは、トークンの有無によらずoffline",
      { captchaToken: null },
      true,
      {},
      "offline",
    ],
  ] as const)(
    "再送の開始は、%s",
    (_name, overrides, offline, fieldErrors, error) => {
      // Given
      const flow = flowWith({ ...onCodeStep, ...overrides });

      // When
      const result = beginResendEmailChangeCode(flow, { offline });

      // Then
      expect(result.request).toBeNull();
      expect(result.state.fieldErrors).toEqual(fieldErrors);
      expect(result.state.error).toBe(error);
      expect(result.state.pending).toBeNull();
    },
  );

  it("待ちが明けてトークン無しのオンラインは、依頼を返さず、再送を実行中の待ちにする", () => {
    // Given
    const flow = flowWith({ ...onCodeStep, captchaToken: null });

    // When
    const result = beginResendEmailChangeCode(flow, { offline: false });

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toMatchObject({
      pending: "resend",
      awaitingCheck: true,
      fieldErrors: {},
      error: null,
    });
  });

  it("失敗の通知で再送の待ちが解けた後に押すと、すぐには失敗を示さず、通常どおり待ちにする", () => {
    // Given
    const waiting = beginResendEmailChangeCode(
      flowWith({ ...onCodeStep, captchaToken: null }),
      { offline: false },
    ).state;
    const released = changeEmailReducer(waiting, { type: "checkWaitReleased" });

    // When
    const result = beginResendEmailChangeCode(released, { offline: false });

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toMatchObject({
      pending: "resend",
      awaitingCheck: true,
      error: null,
    });
    expect(result.state.fieldErrors.captcha).toBeUndefined();
  });

  it("再送の待ちは、トークンが無い再押下では状態を変えず、届いた後の開始では依頼を返し、オフラインなら解く", () => {
    // Given
    const waiting = beginResendEmailChangeCode(
      flowWith({ ...onCodeStep, captchaToken: null }),
      { offline: false },
    ).state;
    const arrived = changeEmailReducer(waiting, {
      type: "captchaChecked",
      token: "fresh",
    });

    // When
    const again = beginResendEmailChangeCode(waiting, { offline: false });
    const resumed = beginResendEmailChangeCode(arrived, { offline: false });
    const offline = beginResendEmailChangeCode(arrived, { offline: true });

    // Then
    expect(again.state).toBe(waiting);
    expect(resumed.request).toEqual({
      email: currentEmail,
      captchaToken: "fresh",
    });
    expect(resumed.state).toMatchObject({
      pending: "resend",
      awaitingCheck: false,
    });
    expect(offline.request).toBeNull();
    expect(offline.state).toMatchObject({
      error: "offline",
      pending: null,
      awaitingCheck: false,
    });
  });

  it("待ちの操作と別の操作は、トークンが届いても開始せず、状態を変えない", () => {
    // Given
    const waiting = beginResendEmailChangeCode(
      flowWith({ ...onCodeStep, captchaToken: null }),
      { offline: false },
    ).state;
    const flow = changeEmailReducer(waiting, {
      type: "captchaChecked",
      token: "fresh",
    });

    // When
    const result = beginConfirmEmailChange(flow, {
      codes: { currentCode: "123456", newCode: "654321" },
      offline: false,
    });

    // Then
    expect(result.state).toBe(flow);
    expect(result.request).toBeNull();
  });

  it("再送の待ちは、待ちを解く事実で解け、実行中を終えてチェックのエラーを示す", () => {
    // Given
    const waiting = beginResendEmailChangeCode(
      flowWith({ ...onCodeStep, captchaToken: null }),
      { offline: false },
    ).state;

    // When
    const result = changeEmailReducer(waiting, { type: "checkWaitReleased" });

    // Then
    expect(result).toMatchObject({
      pending: null,
      awaitingCheck: false,
      fieldErrors: { captcha: "incomplete" },
    });
  });

  it("オフラインで拒否された再送は、チェックのトークンを保つ", () => {
    // Given

    // When
    const result = beginResendEmailChangeCode(onCodeStep, { offline: true });

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toMatchObject({
      error: "offline",
      captchaToken: "token",
    });
  });

  it("現在のメールアドレスを持たないときは、再送を開始せず、状態を変えない", () => {
    // Given
    const flow = flowWith({ ...onCodeStep, currentEmail: null });

    // When
    const result = beginResendEmailChangeCode(flow, { offline: false });

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toBe(flow);
  });
});

describe("changeEmailReducer の再送の結果", () => {
  it("再送の受け付けで、確認できたコードが消え、再送の待ちが60秒で始まり、トークンを消費して実行中を解く", () => {
    // Given
    const resending = flowWith({
      ...pendingOf("resend"),
      confirmedCodes: { currentCode: "111111", newCode: null },
    });

    // When
    const next = changeEmailReducer(resending, { type: "resent" });

    // Then
    expect(next).toMatchObject({
      confirmedCodes: noCodes,
      resendCooldown: 60,
      captchaToken: null,
      pending: null,
    });
  });

  it.each<AuthFailureKind>(["captcha_failed", "rate_limited", "unreachable"])(
    "再送の失敗(%s)は、種類をエラーに残し、確認できたコードを保ち、トークンを消費する",
    (kind) => {
      // Given
      const resending = flowWith({
        ...pendingOf("resend"),
        confirmedCodes: { currentCode: "111111", newCode: null },
      });

      // When
      const next = changeEmailReducer(resending, {
        type: "refused",
        failure: { kind },
      });

      // Then
      expect(next).toMatchObject({
        error: kind,
        confirmedCodes: { currentCode: "111111", newCode: null },
        captchaToken: null,
        pending: null,
      });
    },
  );
});

describe("changeEmailReducer の世代", () => {
  it("要求と再送の受け付けだけが、コード欄の世代を1進める", () => {
    // Given
    const requesting = flowWith({ pending: "request" });
    const resending = pendingOf("resend");

    // When
    const requested = changeEmailReducer(requesting, {
      type: "requested",
      currentEmail,
      newEmail,
    });
    const resent = changeEmailReducer(resending, { type: "resent" });
    const requestFailed = changeEmailReducer(requesting, {
      type: "failed",
      failure: { kind: "other" },
    });
    const refused = changeEmailReducer(resending, {
      type: "refused",
      failure: { kind: "other" },
    });
    const confirmed = changeEmailReducer(
      pendingOf("confirm"),
      confirmedEvent({ expired: ["currentCode"] }),
    );

    // Then
    expect(requested.generation).toBe(requesting.generation + 1);
    expect(resent.generation).toBe(resending.generation + 1);
    expect(requestFailed.generation).toBe(requesting.generation);
    expect(refused.generation).toBe(resending.generation);
    expect(confirmed.generation).toBe(onCodeStep.generation);
  });
});

describe("changeEmailReducer の戻る", () => {
  it("コード確認から戻ると、入力の段階になり、確認できたコードとエラーが消える", () => {
    // Given
    const half = flowWith({
      ...onCodeStep,
      confirmedCodes: { currentCode: "111111", newCode: null },
      error: "code_expired",
    });

    // When
    const next = changeEmailReducer(half, { type: "backed" });

    // Then
    expect(next).toMatchObject({
      step: "email",
      newEmail: null,
      confirmedCodes: noCodes,
      error: null,
      fieldErrors: {},
    });
  });

  it("実行中は戻るを無視し、状態を変えない", () => {
    // Given
    const running = pendingOf("confirm");

    // When
    const next = changeEmailReducer(running, { type: "backed" });

    // Then
    expect(next).toBe(running);
  });
});

describe("changeEmailReducer の再送の待ちとチェック", () => {
  it.each([
    [60, 59],
    [1, 0],
    [0, 0],
  ])("1秒の事実で再送の待ちが%i秒から%i秒になる", (from, to) => {
    // Given
    const flow = flowWith({ ...onCodeStep, resendCooldown: from });

    // When
    const next = changeEmailReducer(flow, { type: "cooldownTicked" });

    // Then
    expect(next.resendCooldown).toBe(to);
  });

  it("チェックの完了の事実で、トークンを持つ", () => {
    // Given
    const flow = flowWith({ ...onCodeStep, captchaToken: null });

    // When
    const next = changeEmailReducer(flow, {
      type: "captchaChecked",
      token: "fresh",
    });

    // Then
    expect(next.captchaToken).toBe("fresh");
  });
});

describe("changeEmailReducer の現在のメールアドレスの読み取り", () => {
  it("読み取りの値は、現在のメールアドレスが無いときだけ反映する", () => {
    // Given

    // When
    const first = changeEmailReducer(initialChangeEmailFlow, {
      type: "currentEmailLoaded",
      email: currentEmail,
    });
    const second = changeEmailReducer(first, {
      type: "currentEmailLoaded",
      email: "stale@example.com",
    });

    // Then
    expect(first.currentEmail).toBe(currentEmail);
    expect(second).toBe(first);
  });

  it("要求の応答の現在のメールアドレスを、古い読み取りで上書きしない", () => {
    // Given
    const accepted = changeEmailReducer(flowWith({ pending: "request" }), {
      type: "requested",
      currentEmail,
      newEmail,
    });

    // When
    const next = changeEmailReducer(accepted, {
      type: "currentEmailLoaded",
      email: "stale@example.com",
    });

    // Then
    expect(next.currentEmail).toBe(currentEmail);
  });
});
