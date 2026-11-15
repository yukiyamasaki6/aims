import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import { createFakePageNavigation } from "@/lib/page-navigation/fake-page-navigation-test-helpers";
import { SETTINGS_PATH } from "@/routes";
import type { CallResult } from "../application/call-result";
import {
  createChangeEmail,
  type EmailChangeConfirmResult,
} from "../application/change-email";
import {
  createFakeChangeEmailAuthenticator,
  FAKE_CURRENT_EMAIL,
} from "../application/change-email-test-helpers";
import type { AuthFailureKind } from "../domain/auth-failure";
import { ChangeEmailForm } from "./change-email-form";

const authText = translatorFor("auth");

const newEmail = "new@example.com";
const code = "123456";

// 外部のTurnstileウィジェット(iframe)を包むコンポーネントのため境界としてモックし、onVerifyの発火を制御する。
const turnstile = vi.hoisted(() => ({
  onVerify: undefined as ((token: string | null) => void) | undefined,
}));
vi.mock("./turnstile", () => ({
  Turnstile: forwardRef<unknown, { onVerify: (token: string | null) => void }>(
    function TurnstileStub(props, ref) {
      turnstile.onVerify = props.onVerify;
      useImperativeHandle(ref, () => ({ reset: vi.fn() }));
      return <div data-testid="turnstile-stub" />;
    },
  ),
}));

function setup(
  results: Parameters<typeof createFakeChangeEmailAuthenticator>[0] = {},
  { offline = false }: { offline?: boolean } = {},
) {
  const authenticator = createFakeChangeEmailAuthenticator(results);
  const connectivity = createFakeConnectivity(offline);
  const clock = createManualClock();
  const navigation = createFakePageNavigation();
  const changeEmail = createChangeEmail({
    authenticator,
    connectivity,
    clock,
    pageNavigation: navigation.pageNavigation,
  });
  const form = <ChangeEmailForm changeEmail={changeEmail} siteKey="site-key" />;
  const rendered = render(form, { wrapper: IntlTestProvider });
  return {
    authenticator,
    connectivity,
    clock,
    navigation,
    form,
    ...rendered,
  };
}

type User = ReturnType<typeof userEvent.setup>;

function emailInput() {
  return screen.getByPlaceholderText(authText("changeEmailNewPlaceholder"));
}

function sendButton() {
  return screen.getByRole("button", { name: authText("otpSendCode") });
}

function codeInput(field: "current" | "new") {
  const label =
    field === "current"
      ? authText("changeEmailCurrentCodeLabel", { email: FAKE_CURRENT_EMAIL })
      : authText("changeEmailNewCodeLabel", { email: newEmail });
  return screen.getByLabelText(label);
}

function queryCodeInput(field: "current" | "new") {
  const label =
    field === "current"
      ? authText("changeEmailCurrentCodeLabel", { email: FAKE_CURRENT_EMAIL })
      : authText("changeEmailNewCodeLabel", { email: newEmail });
  return screen.queryAllByLabelText(label)[0] ?? null;
}

function verifyButton() {
  return screen.getByRole("button", { name: authText("otpVerify") });
}

function resendButton() {
  return screen.getByRole("button", { name: authText("otpResend") });
}

async function requestTo(user: User, email = newEmail) {
  await user.clear(emailInput());
  await user.type(emailInput(), email);
  await user.click(sendButton());
}

async function advanceToCodeStep(user: User) {
  await requestTo(user);
  await screen.findByRole("heading", { name: authText("changeEmailTitle") });
  await screen.findByLabelText(
    authText("changeEmailNewCodeLabel", { email: newEmail }),
  );
}

// 確認済みでない欄にコードを入力して、確認ボタンを押す。
async function confirm(user: User) {
  for (const field of ["current", "new"] as const) {
    const input = queryCodeInput(field);
    if (input instanceof HTMLInputElement) await user.type(input, code);
  }
  await user.click(verifyButton());
}

// 変更前は誤りまたは期限切れ、変更後は確認できた状態にする。
async function confirmOnlyNew(
  authenticator: ReturnType<typeof createFakeChangeEmailAuthenticator>,
  user: User,
) {
  authenticator.confirmEmailChange
    .mockResolvedValueOnce({
      kind: "failed",
      failure: { kind: "code_expired" },
    })
    .mockResolvedValueOnce({ kind: "partial" });
  await advanceToCodeStep(user);
  await confirm(user);
  await screen.findAllByText(
    authText("fieldError.currentCode.expiredOrInvalid"),
  );
}

// 再送の待ちを1秒ずつ進める(1秒ごとに予約をやり直すため、描画を挟んで進める)。
function waitOutCooldown(clock: ReturnType<typeof createManualClock>) {
  for (let i = 0; i < 60; i += 1) act(() => clock.advance(1000));
}

describe("メールアドレス変更画面の部品", () => {
  describe("入力の段階", () => {
    it("現在のメールアドレス、新しいメールアドレスの入力欄、送信ボタンを表示し、パスワード欄は持たない", async () => {
      // Given

      // When
      setup();

      // Then
      expect(
        await screen.findByText(
          authText("changeEmailCurrent", { email: FAKE_CURRENT_EMAIL }),
        ),
      ).toBeInTheDocument();
      expect(emailInput()).toBeInTheDocument();
      expect(sendButton()).toBeInTheDocument();
      expect(
        sendButton().closest("form")?.querySelectorAll("input"),
      ).toHaveLength(1);
    });

    it("現在のメールアドレスが読めないときは、その表示が無い", async () => {
      // Given
      const { authenticator } = setup({ currentEmail: null });

      // When
      await vi.waitFor(() =>
        expect(authenticator.readCurrentEmail).toHaveBeenCalledOnce(),
      );

      // Then
      expect(
        screen.queryByText(
          authText("changeEmailCurrent", { email: "" }).trim(),
          {
            exact: false,
          },
        ),
      ).not.toBeInTheDocument();
    });

    it("現在のメールアドレスが読めなくても、要求を頼める", async () => {
      // Given
      const { authenticator } = setup({ currentEmail: null });
      const user = userEvent.setup();

      // When
      await requestTo(user);

      // Then
      expect(authenticator.requestEmailChange).toHaveBeenCalledOnce();
    });

    it("状態を示す領域は、画面にあり、空である", () => {
      // Given

      // When
      setup();

      // Then
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
    });

    it("水和が済んだ目印をフォームに付ける", () => {
      // Given

      // When
      setup();

      // Then
      expect(sendButton().closest("form")).toHaveAttribute(
        "data-hydrated",
        "true",
      );
    });

    it("新しいメールアドレスの欄に、emailのautocompleteを付ける", () => {
      // Given

      // When
      setup();

      // Then
      expect(emailInput()).toHaveAttribute("autocomplete", "email");
    });

    it("入力した新しいメールアドレスで、要求を1回頼む", async () => {
      // Given
      const { authenticator } = setup();
      const user = userEvent.setup();

      // When
      await requestTo(user);

      // Then
      expect(authenticator.requestEmailChange).toHaveBeenCalledExactlyOnceWith({
        newEmail,
      });
    });

    it.each([
      ["未入力", "", "fieldError.email.required"],
      ["形式の誤り", "not-an-email", "fieldError.email.invalidFormat"],
    ] as const)(
      "新しいメールアドレスが%sなら、欄のエラーを表示し、要求を頼まない",
      async (_name, value, key) => {
        // Given
        const { authenticator } = setup();
        const user = userEvent.setup();

        // When
        if (value) await user.type(emailInput(), value);
        await user.click(sendButton());

        // Then
        const error = screen.getByText(authText(key));
        expect(emailInput()).toHaveAttribute("aria-describedby", error.id);
        expect(authenticator.requestEmailChange).not.toHaveBeenCalled();
      },
    );
  });

  describe("コード確認の段階", () => {
    it("要求が受け付けられると、見出し、変更前と変更後のラベル付きの2つのコード欄、確認ボタン1つ、再送、戻る、迷惑メールの案内を表示し、入力欄は消える", async () => {
      // Given
      setup();
      const user = userEvent.setup();

      // When
      await advanceToCodeStep(user);

      // Then
      expect(codeInput("current")).toBeInTheDocument();
      expect(codeInput("new")).toBeInTheDocument();
      expect(
        screen.getAllByRole("button", { name: authText("otpVerify") }),
      ).toHaveLength(1);
      expect(
        screen.getByRole("button", {
          name: authText("otpResendWait", { seconds: "60" }),
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: authText("back") }),
      ).toBeInTheDocument();
      expect(screen.getByText(authText("otpSpamNote"))).toBeInTheDocument();
      expect(
        screen.queryByPlaceholderText(authText("changeEmailNewPlaceholder")),
      ).toBeNull();
    });

    it("コード欄のラベルに、変更前は現在のメールアドレス、変更後は新しいメールアドレスを差し込む", async () => {
      // Given
      setup();
      const user = userEvent.setup();

      // When
      await advanceToCodeStep(user);

      // Then
      expect(
        screen.getByText(
          authText("changeEmailCurrentCodeLabel", {
            email: FAKE_CURRENT_EMAIL,
          }),
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          authText("changeEmailNewCodeLabel", { email: newEmail }),
        ),
      ).toBeInTheDocument();
    });

    it("2つのコード欄に、one-time-codeのautocompleteを付ける", async () => {
      // Given
      setup();
      const user = userEvent.setup();

      // When
      await advanceToCodeStep(user);

      // Then
      expect(codeInput("current")).toHaveAttribute(
        "autocomplete",
        "one-time-code",
      );
      expect(codeInput("new")).toHaveAttribute("autocomplete", "one-time-code");
    });

    it("確認ボタンを押すと、入力した2つのコードで確認を、変更前、変更後の順に頼む", async () => {
      // Given
      const { authenticator } = setup();
      const user = userEvent.setup();
      await advanceToCodeStep(user);
      await user.type(codeInput("new"), "222222");
      await user.type(codeInput("current"), "111111");

      // When
      await user.click(verifyButton());

      // Then
      expect(authenticator.confirmEmailChange.mock.calls).toEqual([
        [{ email: FAKE_CURRENT_EMAIL, code: "111111" }],
        [{ email: newEmail, code: "222222" }],
      ]);
    });

    it.each([
      ["両方が未入力", [], ["currentCode", "newCode"]],
      ["変更前だけ入力", ["current"], ["newCode"]],
      ["変更後だけ入力", ["new"], ["currentCode"]],
    ] as const)(
      "コードが%sなら、未入力の欄ごとにエラーを表示し、確認を頼まない",
      async (_name, filled, missing) => {
        // Given
        const { authenticator } = setup();
        const user = userEvent.setup();
        await advanceToCodeStep(user);
        for (const field of filled) await user.type(codeInput(field), code);

        // When
        await user.click(verifyButton());

        // Then
        for (const field of ["currentCode", "newCode"] as const) {
          const error = screen.queryByText(
            authText(`fieldError.${field}.required`),
          );
          if (missing.some((m) => m === field))
            expect(error).toBeInTheDocument();
          else expect(error).not.toBeInTheDocument();
        }
        expect(authenticator.confirmEmailChange).not.toHaveBeenCalled();
      },
    );

    it("未入力のコード欄のエラーを、その欄に結びつける", async () => {
      // Given
      setup();
      const user = userEvent.setup();
      await advanceToCodeStep(user);

      // When
      await user.click(verifyButton());

      // Then
      const currentError = screen.getByText(
        authText("fieldError.currentCode.required"),
      );
      const newError = screen.getByText(
        authText("fieldError.newCode.required"),
      );
      expect(codeInput("current")).toHaveAttribute("aria-invalid", "true");
      expect(codeInput("current")).toHaveAttribute(
        "aria-describedby",
        currentError.id,
      );
      expect(codeInput("new")).toHaveAttribute("aria-describedby", newError.id);
    });

    it("待ちが明けても、セキュリティチェックが未完了なら、再送の不備を表示し、再送を頼まない", async () => {
      // Given
      const { authenticator, clock } = setup();
      const user = userEvent.setup();
      await advanceToCodeStep(user);
      waitOutCooldown(clock);

      // When
      await user.click(resendButton());

      // Then
      expect(
        screen.getByText(authText("fieldError.captcha.incomplete")),
      ).toBeInTheDocument();
      expect(authenticator.resendEmailChangeCode).not.toHaveBeenCalled();
    });

    it("戻ると入力の段階に戻る", async () => {
      // Given
      const { navigation } = setup();
      const user = userEvent.setup();
      await advanceToCodeStep(user);

      // When
      await user.click(screen.getByRole("button", { name: authText("back") }));

      // Then
      expect(emailInput()).toBeInTheDocument();
      expect(queryCodeInput("new")).toBeNull();
      expect(navigation.go).not.toHaveBeenCalled();
    });

    it("戻った後に別のメールアドレスで、要求しなおせる", async () => {
      // Given
      const { authenticator } = setup();
      const user = userEvent.setup();
      await advanceToCodeStep(user);
      await user.click(screen.getByRole("button", { name: authText("back") }));

      // When
      await requestTo(user, "another@example.com");

      // Then
      expect(authenticator.requestEmailChange).toHaveBeenLastCalledWith({
        newEmail: "another@example.com",
      });
    });

    it("要求しなおすと、前に入力したコードは消え、コード欄は空で表示される", async () => {
      // Given
      const { authenticator } = setup();
      const user = userEvent.setup();
      await confirmOnlyNew(authenticator, user);
      await user.click(screen.getByRole("button", { name: authText("back") }));

      // When
      await requestTo(user, "another@example.com");

      // Then
      await screen.findByLabelText(
        authText("changeEmailNewCodeLabel", { email: "another@example.com" }),
      );
      for (const input of screen.getAllByPlaceholderText(
        authText("otpCodePlaceholder"),
      )) {
        expect(input).toHaveValue("");
      }
    });
  });

  describe("一方だけの確認と完了", () => {
    it("一方だけ確認できても、表示も案内も変わらず、両方の欄が入力欄のままで、誤りだった欄にだけ欄エラーが出て、全体のエラーは無い", async () => {
      // Given
      const { authenticator } = setup();
      const user = userEvent.setup();

      // When
      await confirmOnlyNew(authenticator, user);

      // Then
      expect(queryCodeInput("current")).toBeInstanceOf(HTMLInputElement);
      expect(queryCodeInput("new")).toBeInstanceOf(HTMLInputElement);
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
      expect(codeInput("current")).toHaveAttribute("aria-invalid", "true");
      expect(codeInput("new")).toHaveAttribute("aria-invalid", "false");
      expect(
        screen.getAllByText(
          authText("fieldError.currentCode.expiredOrInvalid"),
        ),
      ).toHaveLength(1);
    });

    it("誤りだった欄だけを直して確認すると、完了する", async () => {
      // Given
      const { authenticator } = setup();
      const user = userEvent.setup();
      await confirmOnlyNew(authenticator, user);
      authenticator.confirmEmailChange.mockClear();
      authenticator.confirmEmailChange.mockResolvedValueOnce({
        kind: "completed",
      });

      // When
      await user.clear(codeInput("current"));
      await user.type(codeInput("current"), "654321");
      await user.click(verifyButton());

      // Then
      expect(
        await screen.findByText(authText("changeEmailDone")),
      ).toBeVisible();
      expect(authenticator.confirmEmailChange).toHaveBeenCalledExactlyOnceWith({
        email: FAKE_CURRENT_EMAIL,
        code: "654321",
      });
    });

    describe("完了", () => {
      async function complete(
        user: User,
        authenticator: ReturnType<typeof createFakeChangeEmailAuthenticator>,
      ) {
        authenticator.confirmEmailChange
          .mockResolvedValueOnce({ kind: "partial" })
          .mockResolvedValueOnce({ kind: "completed" });
        await advanceToCodeStep(user);
        await confirm(user);
        await screen.findByText(authText("changeEmailDone"));
      }

      it("見出しと戻ると、状態の領域の完了の文言が出て、現在のメールアドレス、入力欄、コード欄、確認と再送の操作は描かれず、画面に留まり、待機の刻みも続かない", async () => {
        // Given
        const { authenticator, clock, navigation } = setup();
        const user = userEvent.setup();
        const region = screen.getByRole("status");

        // When
        await complete(user, authenticator);
        act(() => clock.advance(5000));

        // Then
        expect(screen.getByRole("status")).toBe(region);
        expect(region).toHaveTextContent(authText("changeEmailDone"));
        expect(
          screen.getByRole("heading", { name: authText("changeEmailTitle") }),
        ).toBeInTheDocument();
        expect(
          screen.getAllByRole("button").map((button) => button.textContent),
        ).toEqual([authText("back")]);
        expect(screen.queryByRole("textbox")).toBeNull();
        expect(
          screen.queryByText(
            authText("changeEmailCurrent", { email: newEmail }),
          ),
        ).toBeNull();
        expect(clock.pendingCount()).toBe(0);
        expect(navigation.go).not.toHaveBeenCalled();
        expect(navigation.replace).not.toHaveBeenCalled();
      });

      it("戻るを押すと、設定画面へ移り、入力段階にもコード確認にも戻らない", async () => {
        // Given
        const { authenticator, navigation } = setup();
        const user = userEvent.setup();
        await complete(user, authenticator);

        // When
        await user.click(
          screen.getByRole("button", { name: authText("back") }),
        );

        // Then
        expect(navigation.go).toHaveBeenCalledExactlyOnceWith(SETTINGS_PATH);
        expect(screen.queryByRole("textbox")).toBeNull();
        expect(screen.getByRole("status")).toHaveTextContent(
          authText("changeEmailDone"),
        );
      });

      it("画面を作り直すと、完了の文言は出ず、入力の段階で新しい現在のメールアドレスが表示される", async () => {
        // Given
        const { authenticator, form, unmount } = setup();
        const user = userEvent.setup();
        await complete(user, authenticator);
        unmount();
        authenticator.readCurrentEmail.mockResolvedValue(newEmail);

        // When
        render(form, { wrapper: IntlTestProvider });

        // Then
        expect(
          await screen.findByText(
            authText("changeEmailCurrent", { email: newEmail }),
          ),
        ).toBeInTheDocument();
        expect(screen.queryByText(authText("changeEmailDone"))).toBeNull();
        expect(emailInput()).toHaveValue("");
      });
    });
  });

  describe("再送", () => {
    it("再送が受け付けられると、コード欄が空になり、待ちの残り秒数が再び出て、現在のメールアドレスで再送を頼む", async () => {
      // Given
      const { authenticator, clock } = setup();
      const user = userEvent.setup();
      await confirmOnlyNew(authenticator, user);
      waitOutCooldown(clock);
      act(() => turnstile.onVerify?.("captcha-token"));

      // When
      await user.click(resendButton());

      // Then
      await screen.findByRole("button", {
        name: authText("otpResendWait", { seconds: "60" }),
      });
      expect(
        authenticator.resendEmailChangeCode,
      ).toHaveBeenCalledExactlyOnceWith({
        email: FAKE_CURRENT_EMAIL,
        captchaToken: "captcha-token",
      });
      expect(codeInput("current")).toHaveValue("");
      expect(codeInput("new")).toHaveValue("");
    });

    it("再送の待ちの残り秒数が1秒ごとに減り、0になった後は予約が増えず0のまま、再送が押せる", async () => {
      // Given
      const { clock } = setup();
      const user = userEvent.setup();
      await advanceToCodeStep(user);

      // When
      act(() => clock.advance(1000));
      const oneSecondLater = screen.getByRole("button", {
        name: authText("otpResendWait", { seconds: "59" }),
      });
      for (let i = 0; i < 59; i += 1) act(() => clock.advance(1000));

      // Then
      expect(oneSecondLater).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: authText("otpResend") }),
      ).toHaveAttribute("aria-disabled", "false");
      expect(clock.pendingCount()).toBe(0);
    });
  });

  describe("失敗", () => {
    it.each<AuthFailureKind>([
      "email_exists",
      "same_email",
      "rate_limited",
      "unreachable",
    ])(
      "要求が%sで失敗すると、その文言を表示し、入力した新しいメールアドレスを保つ",
      async (kind) => {
        // Given
        setup({ request: { kind: "failed", failure: { kind } } });
        const user = userEvent.setup();

        // When
        await requestTo(user);

        // Then
        expect(
          await screen.findByText(authText(`failure.${kind}`)),
        ).toBeVisible();
        expect(emailInput()).toHaveValue(newEmail);
      },
    );

    it("使えないメールアドレスの失敗の後に、別のメールアドレスを入力して再び送信できる", async () => {
      // Given
      const { authenticator } = setup();
      authenticator.requestEmailChange.mockResolvedValueOnce({
        kind: "failed",
        failure: { kind: "email_exists" },
      });
      const user = userEvent.setup();
      await requestTo(user);
      await screen.findByText(authText("failure.email_exists"));

      // When
      await user.clear(emailInput());
      await requestTo(user, "other@example.com");

      // Then
      expect(authenticator.requestEmailChange).toHaveBeenLastCalledWith({
        newEmail: "other@example.com",
      });
    });

    it.each([
      ["変更前だけ", false],
      ["両方", true],
    ] as const)(
      "確認の誤りまたは期限切れが%sのときは、誤りだった欄にだけ文言が出て、その欄に結びつき、全体のエラーには出ず、入力したコードは保たれ、直して再び確認できる",
      async (_name, both) => {
        // Given
        const { authenticator } = setup();
        const expired = {
          kind: "failed",
          failure: { kind: "code_expired" },
        } as const;
        authenticator.confirmEmailChange
          .mockResolvedValueOnce(expired)
          .mockResolvedValueOnce(both ? expired : { kind: "partial" });
        const user = userEvent.setup();
        await advanceToCodeStep(user);

        // When
        await confirm(user);

        // Then
        // 欄の文言と全体の文言は同じ文面のため、数で欄だけに出ていることを確かめる。
        const messages = await screen.findAllByText(
          authText("fieldError.currentCode.expiredOrInvalid"),
        );
        expect(messages).toHaveLength(both ? 2 : 1);
        expect(codeInput("current")).toHaveAttribute(
          "aria-describedby",
          messages[0].id,
        );
        expect(codeInput("new")).toHaveAttribute(
          "aria-invalid",
          both ? "true" : "false",
        );
        expect(codeInput("current")).toHaveValue(code);
      },
    );

    it.each<AuthFailureKind>(["rate_limited", "unreachable"])(
      "確認が%sで失敗すると、全体のエラーとして文言が出て、欄エラーは無く、入力したコードは保たれる",
      async (kind) => {
        // Given
        const { authenticator } = setup();
        authenticator.confirmEmailChange.mockResolvedValue({
          kind: "failed",
          failure: { kind },
        });
        const user = userEvent.setup();
        await advanceToCodeStep(user);

        // When
        await confirm(user);

        // Then
        expect(
          await screen.findByText(authText(`failure.${kind}`)),
        ).toBeVisible();
        expect(
          screen.queryByText(
            authText("fieldError.currentCode.expiredOrInvalid"),
          ),
        ).toBeNull();
        expect(codeInput("current")).toHaveValue(code);
        expect(codeInput("new")).toHaveValue(code);
      },
    );

    it("再送がcaptcha_failedで失敗すると、その文言を表示する", async () => {
      // Given
      const { authenticator, clock } = setup();
      authenticator.resendEmailChangeCode.mockResolvedValue({
        kind: "failed",
        failure: { kind: "captcha_failed" },
      });
      const user = userEvent.setup();
      await advanceToCodeStep(user);
      waitOutCooldown(clock);
      act(() => turnstile.onVerify?.("captcha-token"));

      // When
      await user.click(resendButton());

      // Then
      expect(
        await screen.findByText(authText("failure.captcha_failed")),
      ).toBeVisible();
    });

    it("期限切れの後は、戻って要求しなおせる", async () => {
      // Given
      const { authenticator } = setup({
        confirm: { kind: "failed", failure: { kind: "code_expired" } },
      });
      const user = userEvent.setup();
      await advanceToCodeStep(user);
      await confirm(user);
      await screen.findAllByText(
        authText("fieldError.currentCode.expiredOrInvalid"),
      );

      // When
      await user.click(screen.getByRole("button", { name: authText("back") }));
      await requestTo(user);

      // Then
      expect(authenticator.requestEmailChange).toHaveBeenCalledTimes(2);
    });

    it("処理を始めると、以前のエラーの表示が消える", async () => {
      // Given
      const { authenticator } = setup();
      authenticator.confirmEmailChange.mockResolvedValueOnce({
        kind: "failed",
        failure: { kind: "code_expired" },
      });
      const user = userEvent.setup();
      await advanceToCodeStep(user);
      await confirm(user);
      await screen.findAllByText(
        authText("fieldError.currentCode.expiredOrInvalid"),
      );
      const response = Promise.withResolvers<EmailChangeConfirmResult>();
      authenticator.confirmEmailChange.mockReturnValue(response.promise);

      // When
      await user.click(verifyButton());

      // Then
      expect(
        screen.queryByText(authText("fieldError.currentCode.expiredOrInvalid")),
      ).toBeNull();
      await act(async () => response.resolve({ kind: "partial" }));
    });
  });

  describe("処理中の排他", () => {
    type Environment = ReturnType<typeof setup>;

    // 応答を保留した操作を始め、保留を解く関数を返す。
    const holdings = {
      request: async (env: Environment, user: User) => {
        const response =
          Promise.withResolvers<
            Awaited<
              ReturnType<Environment["authenticator"]["requestEmailChange"]>
            >
          >();
        env.authenticator.requestEmailChange.mockReturnValue(response.promise);
        await requestTo(user);
        return () =>
          response.resolve({
            kind: "accepted",
            currentEmail: FAKE_CURRENT_EMAIL,
          });
      },
      confirm: async (env: Environment, user: User) => {
        const response = Promise.withResolvers<EmailChangeConfirmResult>();
        await advanceToCodeStep(user);
        env.authenticator.confirmEmailChange.mockReturnValue(response.promise);
        await confirm(user);
        return () => response.resolve({ kind: "partial" });
      },
      resend: async (env: Environment, user: User) => {
        const response = Promise.withResolvers<CallResult>();
        await advanceToCodeStep(user);
        waitOutCooldown(env.clock);
        act(() => turnstile.onVerify?.("captcha-token"));
        env.authenticator.resendEmailChangeCode.mockReturnValue(
          response.promise,
        );
        await user.click(resendButton());
        return () => response.resolve({ kind: "accepted" });
      },
    };

    it.each([
      ["要求", "request"],
      ["確認", "confirm"],
      ["再送", "resend"],
    ] as const)(
      "%sの応答を待つ間は、全ての操作ボタンがaria-disabledになり、押しても追加の頼みごとは起きない",
      async (_name, pending) => {
        // Given
        const env = setup();
        const user = userEvent.setup();
        const release = await holdings[pending](env, user);

        // When
        const buttons = screen.getAllByRole("button");
        for (const button of buttons) await user.click(button);

        // Then
        for (const button of buttons) {
          expect(button).toHaveAttribute("aria-disabled", "true");
        }
        expect(env.authenticator.requestEmailChange).toHaveBeenCalledTimes(1);
        expect(env.authenticator.confirmEmailChange).toHaveBeenCalledTimes(
          pending === "confirm" ? 1 : 0,
        );
        expect(env.authenticator.resendEmailChangeCode).toHaveBeenCalledTimes(
          pending === "resend" ? 1 : 0,
        );
        await act(async () => release());
      },
    );
  });

  describe("オフライン", () => {
    it("オフラインで送信すると、オフラインの文言を表示し、入力値を保ち、要求を頼まない", async () => {
      // Given
      const { authenticator } = setup({}, { offline: true });
      const user = userEvent.setup();

      // When
      await requestTo(user);

      // Then
      expect(
        await screen.findByText(authText("failure.offline")),
      ).toBeVisible();
      expect(emailInput()).toHaveValue(newEmail);
      expect(authenticator.requestEmailChange).not.toHaveBeenCalled();
    });

    it("オフラインで拒否された後、通信が戻ると、同じ入力で再送信できる", async () => {
      // Given
      const { authenticator, connectivity } = setup({}, { offline: true });
      const user = userEvent.setup();
      await requestTo(user);
      await screen.findByText(authText("failure.offline"));
      connectivity.goOnline();

      // When
      await user.click(sendButton());

      // Then
      expect(authenticator.requestEmailChange).toHaveBeenCalledExactlyOnceWith({
        newEmail,
      });
    });

    it("オフラインでコードを確認すると、オフラインの文言を表示し、コードを保ち、確認を頼まない", async () => {
      // Given
      const { authenticator, connectivity } = setup();
      const user = userEvent.setup();
      await advanceToCodeStep(user);
      connectivity.goOffline();

      // When
      await confirm(user);

      // Then
      expect(
        await screen.findByText(authText("failure.offline")),
      ).toBeVisible();
      expect(codeInput("new")).toHaveValue(code);
      expect(authenticator.confirmEmailChange).not.toHaveBeenCalled();
    });
  });
});
