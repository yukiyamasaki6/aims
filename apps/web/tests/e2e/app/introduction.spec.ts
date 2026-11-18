import type { Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import { SHARED_AUTH_STATE_PATH } from "../helpers/auth";
import { homeHeading } from "../helpers/settings";

const authText = translatorFor("auth");
const introductionText = translatorFor("introduction");

function header(page: Page) {
  return page.getByRole("banner");
}

// 「記録を始める」は、キャッチの下(先頭)と本文の末尾(末尾)の2か所にある。
function startLinks(page: Page) {
  return page
    .getByRole("main")
    .getByRole("link", { name: introductionText("startButton") });
}

function signInLink(page: Page) {
  return header(page).getByRole("link", {
    name: introductionText("headerSignIn"),
  });
}

function signUpLink(page: Page) {
  return header(page).getByRole("link", {
    name: introductionText("headerSignUp"),
  });
}

function catchHeading(page: Page) {
  return page.getByRole("heading", {
    level: 1,
    name: introductionText("catch"),
  });
}

async function expectSignUpScreen(page: Page) {
  await expect(page).toHaveURL(/\/signup$/);
  await expect(
    page.getByRole("heading", { name: authText("signUpTitle") }),
  ).toBeVisible();
}

async function expectSignInScreen(page: Page) {
  await expect(page).toHaveURL(/\/signin$/);
  await expect(
    page.getByRole("heading", { name: authText("signInTitle") }),
  ).toBeVisible();
}

async function expectHomeScreen(page: Page) {
  await expect(page).toHaveURL(/\/rounds$/);
  await expect(homeHeading(page)).toBeVisible();
}

test.describe("紹介画面(未認証)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("紹介画面を開くと、先頭の「記録を始める」を押して、サインアップ画面へ移動する", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(catchHeading(page)).toBeVisible();

    await startLinks(page).first().click();

    await expectSignUpScreen(page);
  });

  test("ヘッダーの「サインイン」を押すと、サインイン画面へ移動する", async ({
    page,
  }) => {
    await page.goto("/");

    await signInLink(page).click();

    await expectSignInScreen(page);
  });

  test("ヘッダーの「サインアップ」を押すと、サインアップ画面へ移動する", async ({
    page,
  }) => {
    await page.goto("/");

    await signUpLink(page).click();

    await expectSignUpScreen(page);
  });

  test("末尾の「記録を始める」を押すと、サインアップ画面へ移動する", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(catchHeading(page)).toBeVisible();

    await startLinks(page).last().click();

    await expectSignUpScreen(page);
  });
});

test.describe("紹介画面(認証済み)", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("紹介画面のまま表示され、先頭の「記録を始める」を押すと、/signupの転送を経て、ホームへ移動する", async ({
    page,
  }) => {
    // 紹介画面を開き、移動せずに表示されることを確かめる。
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(catchHeading(page)).toBeVisible();

    // 先頭の「記録を始める」を押して、転送を経てホームへ進む。
    await startLinks(page).first().click();
    await expectHomeScreen(page);
  });

  test("ヘッダーの「サインイン」を押すと、/signinの転送を経て、ホームへ移動する", async ({
    page,
  }) => {
    await page.goto("/");

    await signInLink(page).click();

    await expectHomeScreen(page);
  });

  test("ヘッダーの「サインアップ」を押すと、/signupの転送を経て、ホームへ移動する", async ({
    page,
  }) => {
    await page.goto("/");

    await signUpLink(page).click();

    await expectHomeScreen(page);
  });
});
