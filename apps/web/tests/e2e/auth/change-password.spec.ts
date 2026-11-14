import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import { signUpAndSignIn, waitForHydration } from "../helpers/auth";
import { signInError, updatePasswordDirect } from "../helpers/auth-api";
import {
  expectSignedOutIn,
  expectStillSignedIn,
  signInOnOtherDevice,
} from "../helpers/other-browser-device";
import { authMethodOf, readStoredTokens } from "../helpers/stored-session";

const authText = translatorFor("auth");

const ORIGINAL_PASSWORD = "password-original1";
const NEW_PASSWORD = "password-changed1";
const ANOTHER_PASSWORD = "password-another1";
const WRONG_PASSWORD = "password-wrong1";
// 規則違反を作る値そのもの(8文字未満)。
const TOO_SHORT_PASSWORD = "abc1";

// パスワードを変えるため、共有の認証状態は使わず、使い捨てのユーザーでサインインして始める。
test.use({ storageState: { cookies: [], origins: [] } });

function newEmail() {
  return `change-password-${Date.now()}-${randomUUID().slice(0, 8)}@aims.test`;
}

function currentPasswordInput(page: Page) {
  return page.getByPlaceholder(authText("changePasswordCurrentPlaceholder"));
}

function newPasswordInput(page: Page) {
  return page.getByPlaceholder(authText("changePasswordNewPlaceholder"), {
    exact: true,
  });
}

function submitButton(page: Page) {
  return page.getByRole("button", { name: authText("changePasswordSubmit") });
}

async function openChangePassword(page: Page) {
  await page.goto("/settings/password");
  await waitForHydration(page);
}

async function change(page: Page, input: { current: string; next: string }) {
  await currentPasswordInput(page).fill(input.current);
  await newPasswordInput(page).fill(input.next);
  await submitButton(page).click();
}

test("現在のパスワードと新しいパスワードを入力して変更すると、完了が表示されて入力が消え、新しいパスワードでだけサインインでき、この端末はサインインしたままである", async ({
  page,
}) => {
  // 現在のパスワードと新しいパスワードを入力して変更し、完了の表示に進む。
  const email = newEmail();
  await signUpAndSignIn(page, { email, password: ORIGINAL_PASSWORD });
  await openChangePassword(page);
  await change(page, { current: ORIGINAL_PASSWORD, next: NEW_PASSWORD });
  await expect(page.getByText(authText("changePasswordDone"))).toBeVisible();
  await expect(currentPasswordInput(page)).toHaveValue("");
  await expect(newPasswordInput(page)).toHaveValue("");
  await expect(page).toHaveURL(/\/settings\/password$/);

  // 別のクライアントでは新しいパスワードだけが使え、この端末はサインインしたままホームを開ける。
  expect(await signInError(email, NEW_PASSWORD)).toBeNull();
  expect(await signInError(email, ORIGINAL_PASSWORD)).toBe(
    "invalid_credentials",
  );
  await page.goto("/rounds");
  await expect(page).toHaveURL(/\/rounds/);
});

test("別の端末でサインインしているとき、この端末がパスワードを変更すると、この端末はサインインしたままで、別の端末は期限が切れた後にサインイン画面へ移動する", async ({
  page,
  browser,
}) => {
  // 別の端末でサインインしておき、この端末でパスワードを変更して完了の表示に進む。
  const email = newEmail();
  const otherDevice = await signInOnOtherDevice(browser, {
    email,
    password: ORIGINAL_PASSWORD,
  });
  await signUpAndSignIn(page, { email, password: ORIGINAL_PASSWORD });
  await openChangePassword(page);
  await change(page, { current: ORIGINAL_PASSWORD, next: NEW_PASSWORD });
  await expect(page.getByText(authText("changePasswordDone"))).toBeVisible();

  // この端末はサインインしたままで、別の端末は期限が切れるとサインイン画面へ移動する。
  await page.goto("/rounds");
  await expect(page).toHaveURL(/\/rounds/);
  await expectSignedOutIn(otherDevice.page);
  await otherDevice.context.close();
});

test("別の端末でサインインしているとき、この端末が誤った現在のパスワードを送って拒否されても、別の端末は期限が切れた後もサインインしたままである", async ({
  page,
  browser,
}) => {
  // 別の端末でサインインしておき、この端末で誤った現在のパスワードを送って、誤りの表示に進む。
  const email = newEmail();
  const otherDevice = await signInOnOtherDevice(browser, {
    email,
    password: ORIGINAL_PASSWORD,
  });
  await signUpAndSignIn(page, { email, password: ORIGINAL_PASSWORD });
  await openChangePassword(page);
  await change(page, { current: WRONG_PASSWORD, next: NEW_PASSWORD });
  await expect(
    page.getByText(authText("failure.current_password_invalid")),
  ).toBeVisible();

  // 別の端末は、期限が切れた後の更新に成功し、サインインしたままである。
  await expectStillSignedIn(otherDevice.page);
  await otherDevice.context.close();
});

test("現在と同じ新しいパスワードを送ると、同じパスワードにはできない旨が表示され、別のパスワードに変更し直せる", async ({
  page,
}) => {
  // 現在と同じパスワードを送って、同じパスワードにはできない旨の表示に進む。
  const email = newEmail();
  await signUpAndSignIn(page, { email, password: ORIGINAL_PASSWORD });
  await openChangePassword(page);
  await change(page, { current: ORIGINAL_PASSWORD, next: ORIGINAL_PASSWORD });
  await expect(page.getByText(authText("failure.same_password"))).toBeVisible();

  // 別のパスワードに変更し直して、完了の表示に進む。
  await newPasswordInput(page).fill(ANOTHER_PASSWORD);
  await submitButton(page).click();
  await expect(page.getByText(authText("changePasswordDone"))).toBeVisible();
  expect(await signInError(email, ANOTHER_PASSWORD)).toBeNull();
});

test("現在のパスワードを誤り、新しいパスワードを規則に反して短くして送ると、規則の文面が表示され、現在のパスワードの誤りは表示されない", async ({
  page,
}) => {
  const email = newEmail();
  await signUpAndSignIn(page, { email, password: ORIGINAL_PASSWORD });
  await openChangePassword(page);
  await change(page, { current: WRONG_PASSWORD, next: TOO_SHORT_PASSWORD });
  await expect(page.getByText(authText("failure.weak_password"))).toBeVisible();
  await expect(
    page.getByText(authText("failure.current_password_invalid")),
  ).not.toBeVisible();
});

test("パスワードでサインインしたセッションが、現在のパスワードを付けずにパスワードを更新しようとしても、拒否され、パスワードは変わらない", async ({
  page,
}) => {
  const email = newEmail();
  await signUpAndSignIn(page, { email, password: ORIGINAL_PASSWORD });
  // 認証コードで得たセッションは検査を免除されるため、先にパスワードで得たセッションであることを確かめる。
  const { accessToken } = await readStoredTokens(page.context());
  expect(authMethodOf(accessToken)).toBe("password");

  const response = await updatePasswordDirect(accessToken, {
    password: NEW_PASSWORD,
  });

  expect(response).toEqual({
    status: 400,
    errorCode: "current_password_required",
  });
  expect(await signInError(email, ORIGINAL_PASSWORD)).toBeNull();
});
