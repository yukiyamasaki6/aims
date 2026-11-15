import { describe, expect, it, vi } from "vitest";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import type { AuthFailureKind } from "../domain/auth-failure";
import {
  type ChangeEmailEvent,
  type ChangeEmailFlow,
  changeEmailReducer,
  initialChangeEmailFlow,
} from "../domain/change-email-flow";
import { createChangeEmail } from "./change-email";
import {
  createFakeChangeEmailAuthenticator,
  FAKE_CURRENT_EMAIL,
} from "./change-email-test-helpers";
import { screenHarness } from "./screen-view-test-helpers";

const newEmail = "New.Address@example.com";
const failed = (
  kind: AuthFailureKind,
): { kind: "failed"; failure: { kind: AuthFailureKind } } => ({
  kind: "failed",
  failure: { kind },
});

function setup(
  results: Parameters<typeof createFakeChangeEmailAuthenticator>[0] = {},
  offline = false,
) {
  const authenticator = createFakeChangeEmailAuthenticator(results);
  const connectivity = createFakeConnectivity(offline);
  const clock = createManualClock();
  const changeEmail = createChangeEmail({
    authenticator,
    connectivity,
    clock,
  });
  return {
    changeEmail,
    authenticator,
    connectivity,
    clock,
    ...screenHarness<ChangeEmailFlow, ChangeEmailEvent>(changeEmailReducer),
  };
}

// 要求を受け付けた後の画面。再送できるよう、待ちを明けてチェックのトークンを持たせる。
function resendable(flow: ChangeEmailFlow): ChangeEmailFlow {
  return {
    ...flow,
    resendCooldown: 0,
    captchaToken: "token",
  };
}

describe("メールアドレス変更の手続き", () => {
  describe("load", () => {
    it("現在のメールアドレスを読み、状態へ渡す", async () => {
      // Given
      const { changeEmail, viewOf } = setup();
      const view = viewOf(initialChangeEmailFlow);

      // When
      await changeEmail.load(view);

      // Then
      expect(view.observedState.currentEmail).toBe(FAKE_CURRENT_EMAIL);
    });

    it("読めないときは、現在のメールアドレスを空のまま、失敗を示さない", async () => {
      // Given
      const { changeEmail, events, viewOf } = setup({ currentEmail: null });
      const view = viewOf(initialChangeEmailFlow);

      // When
      await changeEmail.load(view);

      // Then
      expect(events).toEqual([]);
      expect(view.observedState).toBe(initialChangeEmailFlow);
    });

    it("応答の前に画面を離れたときは、状態を更新しない", async () => {
      // Given
      const { changeEmail, events, screen, viewOf } = setup();
      screen.mounted = false;

      // When
      await changeEmail.load(viewOf(initialChangeEmailFlow));

      // Then
      expect(events).toEqual([]);
    });
  });

  describe("request", () => {
    it("新しいメールアドレスで要求を1回頼み、受け付けならコード確認の段階へ進み、再送の待ちが始まる", async () => {
      // Given
      const { changeEmail, authenticator, viewOf } = setup();
      const view = viewOf(initialChangeEmailFlow);

      // When
      await changeEmail.request({ email: newEmail }, view);

      // Then
      expect(authenticator.requestEmailChange).toHaveBeenCalledExactlyOnceWith({
        newEmail,
      });
      expect(view.observedState).toMatchObject({
        step: "code",
        newEmail,
        currentEmail: FAKE_CURRENT_EMAIL,
        resendCooldown: 60,
        pending: null,
      });
    });

    it("オフラインなら、要求を頼まず、offlineを示す", async () => {
      // Given
      const { changeEmail, authenticator, viewOf } = setup({}, true);
      const view = viewOf(initialChangeEmailFlow);

      // When
      await changeEmail.request({ email: newEmail }, view);

      // Then
      expect(authenticator.requestEmailChange).not.toHaveBeenCalled();
      expect(view.observedState).toMatchObject({
        error: "offline",
        pending: null,
      });
    });

    it("オフラインの読み取りは送信ごとに1回で、購読しない", async () => {
      // Given
      const { changeEmail, connectivity, viewOf } = setup({}, true);

      // When
      await changeEmail.request(
        { email: newEmail },
        viewOf(initialChangeEmailFlow),
      );

      // Then
      expect(connectivity.subscribers()).toEqual({ online: 0 });
    });

    it.each<AuthFailureKind>([
      "email_exists",
      "rate_limited",
      "unreachable",
      "other",
    ])(
      "要求が%sで失敗したときは、その種類が状態に出て、入力の段階のままになる",
      async (kind) => {
        // Given
        const { changeEmail, viewOf } = setup({ request: failed(kind) });
        const view = viewOf(initialChangeEmailFlow);

        // When
        await changeEmail.request({ email: newEmail }, view);

        // Then
        expect(view.observedState).toMatchObject({
          step: "email",
          error: kind,
          pending: null,
        });
      },
    );
  });

  describe("confirm", () => {
    const otherEmail = "another-current@example.com";
    const codes = { currentCode: "111111", newCode: "222222" };

    async function requested(results: Parameters<typeof setup>[0] = {}) {
      const harness = setup({
        request: { kind: "accepted", currentEmail: otherEmail },
        ...results,
      });
      const view = harness.viewOf(initialChangeEmailFlow);
      await harness.changeEmail.request({ email: newEmail }, view);
      return { ...harness, view };
    }

    it("2欄とも呼ぶときは、変更前、変更後の順に、その欄のメールアドレスと入力のコードで1回ずつ確認を頼み、完了なら完了にする(大文字を含むアドレスも入力のまま渡す)", async () => {
      // Given
      const { changeEmail, authenticator, view } = await requested();
      authenticator.confirmEmailChange
        .mockResolvedValueOnce({ kind: "partial" })
        .mockResolvedValueOnce({ kind: "completed" });

      // When
      await changeEmail.confirm({ codes }, view);

      // Then
      expect(authenticator.confirmEmailChange.mock.calls).toEqual([
        [{ email: otherEmail, code: "111111" }],
        [{ email: newEmail, code: "222222" }],
      ]);
      expect(view.observedState).toMatchObject({
        completed: true,
        error: null,
        fieldErrors: {},
      });
    });

    it("確認できたコードと同じ値の欄は呼ばず、もう一方だけを1回頼む", async () => {
      // Given
      const { changeEmail, authenticator, view } = await requested();
      authenticator.confirmEmailChange
        .mockResolvedValueOnce(failed("code_expired"))
        .mockResolvedValueOnce({ kind: "partial" });
      await changeEmail.confirm({ codes }, view);
      authenticator.confirmEmailChange.mockClear();
      authenticator.confirmEmailChange.mockResolvedValueOnce({
        kind: "completed",
      });

      // When
      await changeEmail.confirm(
        { codes: { currentCode: "333333", newCode: "222222" } },
        view,
      );

      // Then
      expect(authenticator.confirmEmailChange).toHaveBeenCalledExactlyOnceWith({
        email: otherEmail,
        code: "333333",
      });
      expect(view.observedState.completed).toBe(true);
    });

    it("確認できたコードを持つ欄の値を変えたときは、その欄を新しい入力として呼ぶ", async () => {
      // Given
      const { changeEmail, authenticator, view } = await requested();
      authenticator.confirmEmailChange
        .mockResolvedValueOnce(failed("code_expired"))
        .mockResolvedValueOnce({ kind: "partial" });
      await changeEmail.confirm({ codes }, view);
      authenticator.confirmEmailChange.mockClear();
      authenticator.confirmEmailChange.mockResolvedValueOnce({
        kind: "completed",
      });

      // When
      await changeEmail.confirm(
        { codes: { currentCode: "111111", newCode: "444444" } },
        view,
      );

      // Then
      expect(authenticator.confirmEmailChange.mock.calls[0]).toEqual([
        { email: otherEmail, code: "111111" },
      ]);
    });

    it("両方が一方だけの確認なら、2欄とも確認できたコードになり、完了にしない", async () => {
      // Given
      const { changeEmail, view } = await requested({
        confirm: { kind: "partial" },
      });

      // When
      await changeEmail.confirm({ codes }, view);

      // Then
      expect(view.observedState).toMatchObject({
        confirmedCodes: codes,
        completed: false,
        step: "code",
        error: null,
        fieldErrors: {},
      });
    });

    it("要求の応答の現在のメールアドレスを、読み取りの古い値でなく確認に使う", async () => {
      // Given
      const { changeEmail, authenticator, viewOf } = setup({
        currentEmail: "stale@example.com",
        request: { kind: "accepted", currentEmail: otherEmail },
      });
      const view = viewOf(initialChangeEmailFlow);
      await changeEmail.load(view);
      await changeEmail.request({ email: newEmail }, view);

      // When
      await changeEmail.confirm({ codes }, view);

      // Then
      expect(authenticator.confirmEmailChange).toHaveBeenCalledWith({
        email: otherEmail,
        code: "111111",
      });
    });

    it("オフラインなら、確認を頼まず、offlineを示す", async () => {
      // Given
      const { changeEmail, authenticator, connectivity, view } =
        await requested();
      connectivity.goOffline();

      // When
      await changeEmail.confirm({ codes }, view);

      // Then
      expect(authenticator.confirmEmailChange).not.toHaveBeenCalled();
      expect(view.observedState.error).toBe("offline");
    });

    it("オフラインで入力に不備があるときは、offlineでなくその不備を示す", async () => {
      // Given
      const { changeEmail, connectivity, view } = await requested();
      connectivity.goOffline();

      // When
      await changeEmail.confirm(
        { codes: { currentCode: "", newCode: "222222" } },
        view,
      );

      // Then
      expect(view.observedState.error).toBeNull();
      expect(view.observedState.fieldErrors).toEqual({
        currentCode: "required",
      });
    });

    it.each([
      [
        "変更前だけ",
        [failed("code_expired"), { kind: "partial" }],
        ["currentCode"],
      ],
      [
        "変更後だけ",
        [{ kind: "partial" }, failed("code_expired")],
        ["newCode"],
      ],
      [
        "両方",
        [failed("code_expired"), failed("code_expired")],
        ["currentCode", "newCode"],
      ],
    ] as const)(
      "誤りまたは期限切れが%sのときは、誤りだった欄にだけ欄エラーが出て、全体のエラーには出ない",
      async (_name, results, fields) => {
        // Given
        const { changeEmail, authenticator, view } = await requested();
        authenticator.confirmEmailChange
          .mockResolvedValueOnce(results[0])
          .mockResolvedValueOnce(results[1]);

        // When
        await changeEmail.confirm({ codes }, view);

        // Then
        expect(Object.keys(view.observedState.fieldErrors).sort()).toEqual(
          [...fields].sort(),
        );
        expect(view.observedState.error).toBeNull();
      },
    );

    it("変更前が確認できて変更後が失敗したときは、変更後の種類が全体に出て、変更前のコードは確認できたコードになる", async () => {
      // Given
      const { changeEmail, authenticator, view } = await requested();
      authenticator.confirmEmailChange
        .mockResolvedValueOnce({ kind: "partial" })
        .mockResolvedValueOnce(failed("rate_limited"));

      // When
      await changeEmail.confirm({ codes }, view);

      // Then
      expect(view.observedState).toMatchObject({
        error: "rate_limited",
        confirmedCodes: { currentCode: "111111", newCode: null },
      });
    });

    it("誤りの欄と、制限の失敗が重なったときは、誤りは欄に、制限は全体に出る", async () => {
      // Given
      const { changeEmail, authenticator, view } = await requested();
      authenticator.confirmEmailChange
        .mockResolvedValueOnce(failed("code_expired"))
        .mockResolvedValueOnce(failed("rate_limited"));

      // When
      await changeEmail.confirm({ codes }, view);

      // Then
      expect(view.observedState).toMatchObject({
        fieldErrors: { currentCode: "expiredOrInvalid" },
        error: "rate_limited",
      });
    });

    it.each<[AuthFailureKind, AuthFailureKind]>([
      ["rate_limited", "unreachable"],
      ["unreachable", "unreachable"],
      ["other", "rate_limited"],
      ["unreachable", "rate_limited"],
      ["other", "unreachable"],
    ])(
      "変更前が%s、変更後が%sで失敗したときは、最初の失敗(変更前の種類)が全体に出て、欄エラーは無く、確認できたコードは増えない",
      async (first, second) => {
        // Given
        const { changeEmail, authenticator, view } = await requested();
        authenticator.confirmEmailChange
          .mockResolvedValueOnce(failed(first))
          .mockResolvedValueOnce(failed(second));

        // When
        await changeEmail.confirm({ codes }, view);

        // Then
        expect(view.observedState).toMatchObject({
          error: first,
          fieldErrors: {},
          confirmedCodes: { currentCode: null, newCode: null },
          pending: null,
        });
      },
    );

    it.each([
      ["変更前が失敗、変更後が確認できた", true, "newCode"],
      ["変更前が確認できた、変更後が失敗", false, "currentCode"],
    ] as const)(
      "%sでも、もう一方を呼び、確認できた欄のコードだけが確認できたコードになる",
      async (_name, currentFails, confirmedField) => {
        // Given
        const { changeEmail, authenticator, view } = await requested();
        const ok = { kind: "partial" } as const;
        authenticator.confirmEmailChange
          .mockResolvedValueOnce(currentFails ? failed("code_expired") : ok)
          .mockResolvedValueOnce(currentFails ? ok : failed("code_expired"));

        // When
        await changeEmail.confirm({ codes }, view);

        // Then
        expect(authenticator.confirmEmailChange).toHaveBeenCalledTimes(2);
        expect(view.observedState.confirmedCodes).toEqual({
          currentCode: confirmedField === "currentCode" ? "111111" : null,
          newCode: confirmedField === "newCode" ? "222222" : null,
        });
      },
    );

    it.each([
      ["確認できたコードを持つ欄の値を変え、変更前を直して送る", true],
      [
        "前の確認の応答が失われ、サーバーで既にもう一方が確認済みのときに再確認する",
        false,
      ],
    ] as const)(
      "%s場面で変更前の確認が完了になったときは、変更後は呼ばず、完了にする",
      async (_name, withConfirmed) => {
        // Given
        const { changeEmail, authenticator, view } = await requested();
        if (withConfirmed) {
          authenticator.confirmEmailChange
            .mockResolvedValueOnce(failed("code_expired"))
            .mockResolvedValueOnce({ kind: "partial" });
          await changeEmail.confirm({ codes }, view);
          authenticator.confirmEmailChange.mockClear();
        }
        authenticator.confirmEmailChange.mockResolvedValueOnce({
          kind: "completed",
        });

        // When
        await changeEmail.confirm(
          { codes: { currentCode: "333333", newCode: "444444" } },
          view,
        );

        // Then
        expect(authenticator.confirmEmailChange).toHaveBeenCalledOnce();
        expect(view.observedState.completed).toBe(true);
      },
    );

    it("全ての呼び出しが終わるまで実行中で、その間は3つの操作を拒否し、認証の呼び出しは増えない", async () => {
      // Given
      const { changeEmail, authenticator, view } = await requested();
      const second = Promise.withResolvers<{ kind: "partial" }>();
      authenticator.confirmEmailChange
        .mockResolvedValueOnce({ kind: "partial" })
        .mockReturnValueOnce(second.promise);
      const running = changeEmail.confirm({ codes }, view);
      await vi.waitFor(() =>
        expect(authenticator.confirmEmailChange).toHaveBeenCalledTimes(2),
      );

      // When
      await changeEmail.confirm({ codes }, view);
      await changeEmail.request({ email: newEmail }, view);
      await changeEmail.resend(view);
      const duringPending = view.observedState.pending;
      second.resolve({ kind: "partial" });
      await running;

      // Then
      expect(duringPending).toBe("confirm");
      expect(authenticator.confirmEmailChange).toHaveBeenCalledTimes(2);
      expect(authenticator.requestEmailChange).toHaveBeenCalledOnce();
      expect(authenticator.resendEmailChangeCode).not.toHaveBeenCalled();
      expect(view.observedState.pending).toBeNull();
    });

    it.each([
      ["一方成功・一方失敗", [{ kind: "partial" }, failed("code_expired")]],
      ["両方失敗", [failed("code_expired"), failed("rate_limited")]],
      ["完了", [{ kind: "partial" }, { kind: "completed" }]],
    ] as const)(
      "結果が%sでも、確認の結果は1回だけ反映する",
      async (_name, results) => {
        // Given
        const { changeEmail, authenticator, events, view } = await requested();
        authenticator.confirmEmailChange
          .mockResolvedValueOnce(results[0])
          .mockResolvedValueOnce(results[1]);
        events.length = 0;

        // When
        await changeEmail.confirm({ codes }, view);

        // Then
        expect(events.map((event) => event.type)).toEqual(["confirmed"]);
      },
    );
  });

  describe("resend", () => {
    const otherEmail = "another-current@example.com";

    async function requested(options: Parameters<typeof setup>[0] = {}) {
      const harness = setup({
        request: { kind: "accepted", currentEmail: otherEmail },
        ...options,
      });
      const view = harness.viewOf(initialChangeEmailFlow);
      await harness.changeEmail.request({ email: newEmail }, view);
      return { ...harness, view };
    }

    it("再送には、新しいメールアドレスでなく、要求の応答の現在のメールアドレスとチェックのトークンを渡す", async () => {
      // Given
      const { changeEmail, authenticator, viewOf } = setup({
        request: { kind: "accepted", currentEmail: otherEmail },
      });
      const view = viewOf(initialChangeEmailFlow);
      await changeEmail.request({ email: newEmail }, view);
      const ready = viewOf(resendable(view.observedState));

      // When
      await changeEmail.resend(ready);

      // Then
      expect(
        authenticator.resendEmailChangeCode,
      ).toHaveBeenCalledExactlyOnceWith({
        email: otherEmail,
        captchaToken: "token",
      });
    });

    it("読み取りが古い値でも、再送の現在のメールアドレスは要求の応答の値になる", async () => {
      // Given
      const { changeEmail, authenticator, viewOf } = setup({
        currentEmail: "stale@example.com",
        request: { kind: "accepted", currentEmail: otherEmail },
      });
      const view = viewOf(initialChangeEmailFlow);
      await changeEmail.load(view);
      await changeEmail.request({ email: newEmail }, view);
      const ready = viewOf(resendable(view.observedState));

      // When
      await changeEmail.resend(ready);

      // Then
      expect(authenticator.resendEmailChangeCode).toHaveBeenCalledWith(
        expect.objectContaining({ email: otherEmail }),
      );
    });

    it("再送が受け付けられたときは、確認できたコードが消え、世代が進み、待ちが60秒で再び始まり、チェックのやり直しを頼む", async () => {
      // Given
      const { changeEmail, resetCheck, viewOf, view } = await requested();
      await changeEmail.confirm(
        { codes: { currentCode: "111111", newCode: "222222" } },
        view,
      );
      const ready = viewOf(resendable(view.observedState));
      const generation = ready.observedState.generation;

      // When
      await changeEmail.resend(ready);

      // Then
      expect(ready.observedState).toMatchObject({
        confirmedCodes: { currentCode: null, newCode: null },
        generation: generation + 1,
        resendCooldown: 60,
        captchaToken: null,
      });
      expect(resetCheck).toHaveBeenCalledOnce();
    });

    it.each([
      ["待ち時間が残っている", { resendCooldown: 30 }, false],
      ["チェックが未完了", { captchaToken: null }, false],
      ["オフライン", {}, true],
    ] as const)("%sなら、再送を頼まない", async (_name, overrides, offline) => {
      // Given
      const { changeEmail, authenticator, connectivity, viewOf, view } =
        await requested();
      if (offline) connectivity.goOffline();
      const blocked = viewOf({
        ...resendable(view.observedState),
        ...overrides,
      });

      // When
      await changeEmail.resend(blocked);

      // Then
      expect(authenticator.resendEmailChangeCode).not.toHaveBeenCalled();
    });

    it.each<AuthFailureKind>(["captcha_failed", "rate_limited", "unreachable"])(
      "再送が%sで失敗したときは、その種類が出て、チェックのやり直しを頼む",
      async (kind) => {
        // Given
        const { changeEmail, authenticator, resetCheck, viewOf, view } =
          await requested();
        authenticator.resendEmailChangeCode.mockResolvedValueOnce(failed(kind));
        const ready = viewOf(resendable(view.observedState));

        // When
        await changeEmail.resend(ready);

        // Then
        expect(ready.observedState).toMatchObject({
          error: kind,
          captchaToken: null,
        });
        expect(resetCheck).toHaveBeenCalledOnce();
      },
    );

    it("オフラインで拒否された再送は、チェックのやり直しを頼まない", async () => {
      // Given
      const { changeEmail, connectivity, resetCheck, viewOf, view } =
        await requested();
      connectivity.goOffline();
      const ready = viewOf(resendable(view.observedState));

      // When
      await changeEmail.resend(ready);

      // Then
      expect(ready.observedState.captchaToken).toBe("token");
      expect(resetCheck).not.toHaveBeenCalled();
    });
  });

  describe("tickCooldown", () => {
    it("1秒後(999msでは送らない)にcooldownTickedを1回送る", () => {
      // Given
      const { changeEmail, clock, events, viewOf } = setup();
      const view = viewOf(initialChangeEmailFlow);

      // When
      changeEmail.tickCooldown(view.dispatch);
      clock.advance(999);
      const before = events.length;
      clock.advance(1);

      // Then
      expect(before).toBe(0);
      expect(events).toEqual([{ type: "cooldownTicked" }]);
    });

    it("返した関数で取り消すと、cooldownTickedを送らない", () => {
      // Given
      const { changeEmail, clock, events, viewOf } = setup();
      const view = viewOf(initialChangeEmailFlow);

      // When
      const cancel = changeEmail.tickCooldown(view.dispatch);
      cancel();
      clock.advance(1000);

      // Then
      expect(events).toEqual([]);
    });
  });

  describe("実行中と離脱", () => {
    const pendingFlow: ChangeEmailFlow = {
      ...initialChangeEmailFlow,
      step: "code",
      currentEmail: FAKE_CURRENT_EMAIL,
      newEmail,
      captchaToken: "token",
      pending: "request",
    };

    it("実行中なら、3つの操作のどれも認証を頼まず、何も送らない", async () => {
      // Given
      const { changeEmail, authenticator, events, viewOf } = setup();
      const view = viewOf(pendingFlow);

      // When
      await changeEmail.request({ email: newEmail }, view);
      await changeEmail.confirm(
        { codes: { currentCode: "1", newCode: "2" } },
        view,
      );
      await changeEmail.resend(view);

      // Then
      expect(authenticator.requestEmailChange).not.toHaveBeenCalled();
      expect(authenticator.confirmEmailChange).not.toHaveBeenCalled();
      expect(authenticator.resendEmailChangeCode).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    });

    const operations = [
      [
        "request",
        (changeEmail: ReturnType<typeof setup>["changeEmail"], view: never) =>
          changeEmail.request({ email: newEmail }, view),
        initialChangeEmailFlow,
        "requestEmailChange",
        { kind: "accepted", currentEmail: "x" },
        1,
      ],
      [
        "confirm",
        (changeEmail: ReturnType<typeof setup>["changeEmail"], view: never) =>
          changeEmail.confirm(
            { codes: { currentCode: "111111", newCode: "222222" } },
            view,
          ),
        { ...pendingFlow, pending: null },
        "confirmEmailChange",
        { kind: "partial" },
        2,
      ],
      [
        "resend",
        (changeEmail: ReturnType<typeof setup>["changeEmail"], view: never) =>
          changeEmail.resend(view),
        { ...pendingFlow, pending: null, resendCooldown: 0 },
        "resendEmailChangeCode",
        { kind: "accepted" },
        1,
      ],
    ] as const;

    it.each(operations)(
      "%sを同じタスクで続けて2回呼んでも、2回目は拒否され、認証の呼び出しは増えない",
      async (_name, run, flow, call, resolved, calls) => {
        // Given
        const { changeEmail, authenticator, viewOf } = setup();
        const view = viewOf(flow);
        const response = Promise.withResolvers<never>();
        authenticator[call].mockReturnValue(response.promise);

        // When
        const first = run(changeEmail, view as never);
        const second = run(changeEmail, view as never);
        response.resolve(resolved as never);
        await Promise.all([first, second]);

        // Then
        expect(authenticator[call]).toHaveBeenCalledTimes(calls);
      },
    );

    it.each(operations)(
      "%sの応答の前に画面を離れても、呼び出しは頼んだまま進み、応答の後に状態を更新しない",
      async (_name, run, flow, call, resolved, calls) => {
        // Given
        const { changeEmail, authenticator, events, screen, viewOf } = setup();
        const view = viewOf(flow);
        const response = Promise.withResolvers<never>();
        authenticator[call].mockReturnValue(response.promise);
        const running = run(changeEmail, view as never);

        // When
        screen.mounted = false;
        response.resolve(resolved as never);
        await running;

        // Then
        expect(authenticator[call]).toHaveBeenCalledTimes(calls);
        expect(events).toEqual([]);
      },
    );
  });

  it("オフラインで送信して拒否された後、オンラインで再送信すると、要求は1回だけ頼まれる", async () => {
    // Given
    const { changeEmail, authenticator, connectivity, viewOf } = setup(
      {},
      true,
    );
    const view = viewOf(initialChangeEmailFlow);
    await changeEmail.request({ email: newEmail }, view);

    // When
    connectivity.goOnline();
    await changeEmail.request({ email: newEmail }, view);

    // Then
    expect(authenticator.requestEmailChange).toHaveBeenCalledExactlyOnceWith({
      newEmail,
    });
    expect(view.observedState).toMatchObject({ step: "code", error: null });
  });
});
