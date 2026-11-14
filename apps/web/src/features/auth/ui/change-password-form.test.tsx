import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import type { CallResult } from "../application/call-result";
import { createChangePassword } from "../application/change-password";
import { createFakeChangePasswordAuthenticator } from "../application/change-password-test-helpers";
import type { AuthFailureKind } from "../domain/auth-failure";
import { ChangePasswordForm } from "./change-password-form";

const authText = translatorFor("auth");

const accepted: CallResult = { kind: "accepted" };
const input = {
  currentPassword: "password-original1",
  newPassword: "password-changed1",
};

function setup({ offline = false }: { offline?: boolean } = {}) {
  const authenticator = createFakeChangePasswordAuthenticator();
  const changePassword = createChangePassword({
    authenticator,
    connectivity: createFakeConnectivity(offline),
  });
  const form = <ChangePasswordForm changePassword={changePassword} />;
  const rendered = render(form, { wrapper: IntlTestProvider });
  return { authenticator, form, ...rendered };
}

function currentInput() {
  return screen.getByPlaceholderText(
    authText("changePasswordCurrentPlaceholder"),
  );
}

function newInput() {
  return screen.getByPlaceholderText(authText("changePasswordNewPlaceholder"));
}

function submitButton() {
  return screen.getByRole("button", { name: authText("changePasswordSubmit") });
}

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(currentInput(), input.currentPassword);
  await user.type(newInput(), input.newPassword);
}

describe("パスワード変更画面の部品", () => {
  it("現在のパスワードと新しいパスワードの2欄と変更ボタンを表示し、確認用の欄は持たない", () => {
    // Given

    // When
    setup();

    // Then
    expect(currentInput()).toBeInTheDocument();
    expect(newInput()).toBeInTheDocument();
    expect(submitButton()).toBeInTheDocument();
    expect(
      submitButton().closest("form")?.querySelectorAll("input"),
    ).toHaveLength(2);
  });

  it("現在のパスワードの欄にはcurrent-password、新しいパスワードの欄にはnew-passwordのautocompleteを付ける", () => {
    // Given

    // When
    setup();

    // Then
    expect(currentInput()).toHaveAttribute("autocomplete", "current-password");
    expect(newInput()).toHaveAttribute("autocomplete", "new-password");
  });

  it("完了を伝える領域は、完了の前から画面にあり、空である", () => {
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
    expect(submitButton().closest("form")).toHaveAttribute(
      "data-hydrated",
      "true",
    );
  });

  it("欄ごとに表示を切り替えられ、切り替えても入力値を保つ", async () => {
    // Given
    setup();
    const user = userEvent.setup();
    await fill(user);

    // When
    const [showCurrent] = screen.getAllByRole("button", {
      name: authText("passwordShow"),
    });
    await user.click(showCurrent);

    // Then
    expect(currentInput()).toHaveAttribute("type", "text");
    expect(currentInput()).toHaveValue(input.currentPassword);
    expect(newInput()).toHaveAttribute("type", "password");
    expect(newInput()).toHaveValue(input.newPassword);
  });

  it("入力した現在のパスワードと新しいパスワードで更新を頼む", async () => {
    // Given
    const { authenticator } = setup();
    const user = userEvent.setup();
    await fill(user);

    // When
    await user.click(submitButton());

    // Then
    expect(authenticator.updatePassword).toHaveBeenCalledExactlyOnceWith(input);
  });

  it("何も入力せずに送信すると、2つの欄の未入力の誤りを全て表示し、更新を頼まない", async () => {
    // Given
    const { authenticator } = setup();
    const user = userEvent.setup();

    // When
    await user.click(submitButton());

    // Then
    const currentError = screen.getByText(
      authText("fieldError.currentPassword.required"),
    );
    const newError = screen.getByText(
      authText("fieldError.newPassword.required"),
    );
    expect(currentInput()).toHaveAttribute("aria-invalid", "true");
    expect(currentInput()).toHaveAttribute("aria-describedby", currentError.id);
    expect(newInput()).toHaveAttribute("aria-invalid", "true");
    expect(newInput()).toHaveAttribute("aria-describedby", newError.id);
    expect(authenticator.updatePassword).not.toHaveBeenCalled();
  });

  it("新しいパスワードに許さない文字を含むと、規則の誤りを新しいパスワードの欄へ表示し、更新を頼まない", async () => {
    // Given
    const { authenticator } = setup();
    const user = userEvent.setup();
    await user.type(currentInput(), input.currentPassword);
    await user.type(newInput(), "ｐａｓｓｗｏｒｄ１");

    // When
    await user.click(submitButton());

    // Then
    const error = screen.getByText(
      authText("fieldError.newPassword.invalidRule"),
    );
    expect(newInput()).toHaveAttribute("aria-describedby", error.id);
    expect(currentInput()).toHaveAttribute("aria-invalid", "false");
    expect(authenticator.updatePassword).not.toHaveBeenCalled();
  });

  it("処理中は、変更ボタンをaria-disabledにする", async () => {
    // Given
    const { authenticator } = setup();
    const response = Promise.withResolvers<CallResult>();
    authenticator.updatePassword.mockReturnValue(response.promise);
    const user = userEvent.setup();
    await fill(user);

    // When
    await user.click(submitButton());

    // Then
    expect(submitButton()).toHaveAttribute("aria-disabled", "true");
    await act(async () => response.resolve(accepted));
  });

  it("処理を始めると、以前のエラーの表示が消える", async () => {
    // Given
    const { authenticator } = setup();
    authenticator.updatePassword.mockResolvedValueOnce({
      kind: "failed",
      failure: { kind: "current_password_invalid" },
    });
    const user = userEvent.setup();
    await fill(user);
    await user.click(submitButton());
    await screen.findByText(authText("failure.current_password_invalid"));
    const response = Promise.withResolvers<CallResult>();
    authenticator.updatePassword.mockReturnValue(response.promise);

    // When
    await user.click(submitButton());

    // Then
    expect(
      screen.queryByText(authText("failure.current_password_invalid")),
    ).not.toBeInTheDocument();
    await act(async () => response.resolve(accepted));
  });

  describe("完了", () => {
    async function complete(user: ReturnType<typeof userEvent.setup>) {
      await fill(user);
      await user.click(submitButton());
      await screen.findByText(authText("changePasswordDone"));
    }

    it("完了の文言を表示し、入力値を消し、画面に留まる", async () => {
      // Given
      setup();
      const user = userEvent.setup();
      await fill(user);

      // When
      await user.click(submitButton());

      // Then
      expect(
        await screen.findByText(authText("changePasswordDone")),
      ).toBeVisible();
      expect(currentInput()).toHaveValue("");
      expect(newInput()).toHaveValue("");
      expect(submitButton()).toHaveAttribute("aria-disabled", "false");
    });

    it("表示を切り替えていた欄も、完了で初期の表示(非表示)に戻る", async () => {
      // Given
      setup();
      const user = userEvent.setup();
      await fill(user);
      const [showCurrent] = screen.getAllByRole("button", {
        name: authText("passwordShow"),
      });
      await user.click(showCurrent);

      // When
      await user.click(submitButton());

      // Then
      await screen.findByText(authText("changePasswordDone"));
      expect(currentInput()).toHaveAttribute("type", "password");
    });

    it("完了の後にも、入力し直して再び変更できる", async () => {
      // Given
      const { authenticator } = setup();
      const user = userEvent.setup();
      await complete(user);

      // When
      await user.type(currentInput(), "password-changed1");
      await user.type(newInput(), "password-another1");
      await user.click(submitButton());

      // Then
      expect(authenticator.updatePassword).toHaveBeenLastCalledWith({
        currentPassword: "password-changed1",
        newPassword: "password-another1",
      });
    });

    it("完了で、完了の前から画面にあった領域に、完了の文言が入る", async () => {
      // Given
      setup();
      const user = userEvent.setup();
      const region = screen.getByRole("status");
      await fill(user);

      // When
      await user.click(submitButton());

      // Then
      await screen.findByText(authText("changePasswordDone"));
      expect(screen.getByRole("status")).toBe(region);
      expect(region).toHaveTextContent(authText("changePasswordDone"));
    });

    it("完了の後も、送信ボタンにフォーカスが残る", async () => {
      // Given
      setup();
      const user = userEvent.setup();
      await fill(user);

      // When
      await user.click(submitButton());

      // Then
      await screen.findByText(authText("changePasswordDone"));
      expect(submitButton()).toHaveFocus();
    });

    it("画面を作り直すと、完了の文言は出ず、入力欄は空である", async () => {
      // Given
      const { authenticator, form, unmount } = setup();
      const user = userEvent.setup();
      await complete(user);
      unmount();

      // When
      render(form, { wrapper: IntlTestProvider });

      // Then
      expect(
        screen.queryByText(authText("changePasswordDone")),
      ).not.toBeInTheDocument();
      expect(currentInput()).toHaveValue("");
      expect(newInput()).toHaveValue("");
      expect(authenticator.updatePassword).toHaveBeenCalledOnce();
    });
  });

  describe("失敗", () => {
    it.each<AuthFailureKind>([
      "current_password_invalid",
      "same_password",
      "weak_password",
      "rate_limited",
      "unreachable",
      "other",
    ])("%sで失敗すると、その文言を表示し、入力値を保つ", async (kind) => {
      // Given
      const { authenticator } = setup();
      authenticator.updatePassword.mockResolvedValue({
        kind: "failed",
        failure: { kind },
      });
      const user = userEvent.setup();
      await fill(user);

      // When
      await user.click(submitButton());

      // Then
      expect(
        await screen.findByText(authText(`failure.${kind}`)),
      ).toBeVisible();
      expect(currentInput()).toHaveValue(input.currentPassword);
      expect(newInput()).toHaveValue(input.newPassword);
      expect(screen.queryByText(authText("changePasswordDone"))).toBeNull();
    });

    it("現在のパスワードの誤りの文言は、サインインの認証失敗の文言と異なる", () => {
      // Given

      // When
      const current = authText("failure.current_password_invalid");
      const signIn = authText("failure.invalid_credentials");

      // Then
      expect(current).not.toBe(signIn);
    });

    it("オフラインで送信すると、オフラインの文言を表示し、入力値を保ち、更新を頼まない", async () => {
      // Given
      const { authenticator } = setup({ offline: true });
      const user = userEvent.setup();
      await fill(user);

      // When
      await user.click(submitButton());

      // Then
      expect(
        await screen.findByText(authText("failure.offline")),
      ).toBeVisible();
      expect(currentInput()).toHaveValue(input.currentPassword);
      expect(newInput()).toHaveValue(input.newPassword);
      expect(authenticator.updatePassword).not.toHaveBeenCalled();
    });
  });
});
