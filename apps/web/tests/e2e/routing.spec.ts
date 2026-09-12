// `/`・`/signin`・`/signup`・`/reset-password`・`/rounds`配下のガードは全て
// `apps/web/src/proxy.ts`（`updateSession`）という単一の実装で判定されている。
// 画面ごとに分散させず、この横断的なルーティングの振る舞いとしてここに集約する。

import { expect, test } from "./fixtures";
import { SHARED_AUTH_STATE_PATH } from "./helpers/auth";

test.describe(() => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("認証済みで/にアクセスすると/roundsにリダイレクトされる", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/rounds/);
  });

  test("認証済みで/signinにアクセスすると/roundsにリダイレクトされる", async ({
    page,
  }) => {
    await page.goto("/signin");

    await expect(page).toHaveURL(/\/rounds/);
  });

  test("認証済みで/signupにアクセスすると/roundsにリダイレクトされる", async ({
    page,
  }) => {
    await page.goto("/signup");

    await expect(page).toHaveURL(/\/rounds/);
  });

  test("認証済みで/reset-passwordにアクセスすると/roundsにリダイレクトされる", async ({
    page,
  }) => {
    await page.goto("/reset-password");

    await expect(page).toHaveURL(/\/rounds/);
  });
});

test.describe(() => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("未認証で/roundsにアクセスすると/signinにリダイレクトされる", async ({
    page,
  }) => {
    await page.goto("/rounds");

    await expect(page).toHaveURL(/\/signin/);
  });

  test("未認証で/rounds/newにアクセスすると/signinにリダイレクトされる", async ({
    page,
  }) => {
    await page.goto("/rounds/new");

    await expect(page).toHaveURL(/\/signin/);
  });

  test("未認証で/rounds/[id]にアクセスすると/signinにリダイレクトされる", async ({
    page,
  }) => {
    await page.goto("/rounds/00000000-0000-0000-0000-000000000000");

    await expect(page).toHaveURL(/\/signin/);
  });
});
