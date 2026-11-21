import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { translatorFor } from "@/i18n/translator-test-helpers";
import {
  CHANGE_EMAIL_HASH,
  DELETE_ACCOUNT_HASH,
  ROUNDS_HOME_PATH,
  SETTINGS_ACCOUNT_HASH,
} from "@/routes";
import { expect, test } from "../fixtures";
import {
  SHARED_AUTH_STATE_PATH,
  signInWithEmailOtp,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import { createGoogleLinkedUser } from "../helpers/auth-db";
import { blockGoogle, returnCancelledFromGoogle } from "../helpers/google-auth";
import {
  accountCategory,
  closeButton,
  expectAccountCategory,
  homeHeading,
  openHomeThenSettings,
  openSettingsByItem,
  settingsPanel,
} from "../helpers/settings";
import { AUTH_COOKIE } from "../helpers/stored-session";

const authText = translatorFor("auth");
const settingsText = translatorFor("settings");

function signOutButton(page: Page) {
  return settingsPanel(page).getByRole("button", { name: authText("signOut") });
}

async function openHome(page: Page) {
  await page.goto(ROUNDS_HOME_PATH);
  await waitForHydration(page);
}

// パネルを閉じて、背景の画面(ホーム)が表示され、ハッシュが外れていることを確かめる。
async function expectClosedOnHome(page: Page) {
  await expect(settingsPanel(page)).toBeHidden();
  await expect(page).toHaveURL(/\/rounds$/);
  await expect(homeHeading(page)).toBeVisible();
}

test.describe("認証済み", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test.describe("開く", () => {
    test("ホームで「設定」項目を押すと、その上に「設定」の対話が開き、分類「アカウント」が選ばれ、URLが#settings/accountになる。背景の画面は読み込み直されず、閉じると開く前の画面が表示される", async ({
      page,
    }) => {
      // ホームを開き、背景の画面に目印を置き、文書とRSCの再取得を数え始める。
      await openHome(page);
      await page.evaluate(() => {
        (window as unknown as { e2eMarker: string }).e2eMarker = "kept";
      });
      const reloads: string[] = [];
      page.on("request", (request) => {
        // リンクの先読み(next-router-prefetch)は、画面の再取得ではない。
        const prefetch = "next-router-prefetch" in request.headers();
        const refetch = request.url().includes("_rsc=") && !prefetch;
        if (request.isNavigationRequest() || refetch)
          reloads.push(request.url());
      });

      // 「設定」項目を押して、設定パネルを開く。
      await openSettingsByItem(page);
      await expect(accountCategory(page)).toHaveAttribute(
        "aria-current",
        "page",
      );

      // 閉じて、開く前の画面が目印を保ったまま表示される。
      await closeButton(page).click();
      await expectClosedOnHome(page);
      expect(
        await page.evaluate(
          () => (window as unknown as { e2eMarker?: string }).e2eMarker,
        ),
      ).toBe("kept");
      expect(reloads).toEqual([]);
    });
  });

  test.describe("中を使う", () => {
    test("分類「アカウント」にメールアドレス・Google認証・アカウント削除の行とサインアウトがあり、レフトパネルにサインアウトのボタンは無く、本文に分類の見出しは無い", async ({
      page,
    }) => {
      await openHomeThenSettings(page);

      const panel = settingsPanel(page);
      for (const row of [
        "emailRow",
        "googleRow",
        "deleteAccountRow",
      ] as const) {
        await expect(panel.getByText(settingsText(row))).toBeVisible();
      }
      for (const action of ["emailChange", "deleteAccountAction"] as const) {
        await expect(
          panel.getByRole("link", { name: settingsText(action), exact: true }),
        ).toBeVisible();
      }
      await expect(signOutButton(page)).toBeVisible();
      await expect(
        page
          .getByRole("complementary", { includeHidden: true })
          .getByRole("button", {
            name: authText("signOut"),
            includeHidden: true,
          }),
      ).toHaveCount(0);
      await expect(
        panel.getByRole("heading", { name: settingsText("accountTitle") }),
      ).toHaveCount(0);
    });

    for (const [item, title, hash] of [
      ["emailChange", "changeEmailTitle", CHANGE_EMAIL_HASH],
      ["deleteAccountAction", "deleteAccountTitle", DELETE_ACCOUNT_HASH],
    ] as const) {
      test(`「${settingsText(item)}」項目を押すと、設定パネルの中に項目の画面が出て、URLが${hash}になる`, async ({
        page,
      }) => {
        await openHomeThenSettings(page);

        await settingsPanel(page)
          .getByRole("link", { name: settingsText(item), exact: true })
          .click();

        await expect(
          settingsPanel(page).getByRole("heading", {
            name: authText(title),
          }),
        ).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`${hash}$`));
      });
    }

    test("項目の画面で分類の一覧の「アカウント」を押すと、分類の表示へ移り、URLが#settings/accountになる", async ({
      page,
    }) => {
      await openHomeThenSettings(page);
      await settingsPanel(page)
        .getByRole("link", { name: settingsText("emailChange"), exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`${CHANGE_EMAIL_HASH}$`));

      await accountCategory(page).click();

      await expect(page).toHaveURL(new RegExp(`${SETTINGS_ACCOUNT_HASH}$`));
      await expect(signOutButton(page)).toBeVisible();
    });
  });
});

test.describe("Googleのアカウント", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  function googleRemoveButton(page: Page) {
    return settingsPanel(page).getByRole("button", {
      name: authText("linkGoogleRemove"),
    });
  }

  function googleAddButton(page: Page) {
    return settingsPanel(page).getByRole("button", {
      name: authText("linkGoogleAdd"),
    });
  }

  // メールのコードでサインインして、ホームから設定の分類「アカウント」を開いたことの確認で終わる。
  async function signInByCodeAndOpenSettings(page: Page, email: string) {
    await signUpAndSignIn(page, { email, password: "unused-password1" });
    await openHomeThenSettings(page);
  }

  test("Googleで作ったアカウントは、メールのコードでサインインでき、設定にGoogleのアドレスと「削除」が出る", async ({
    page,
  }) => {
    // Googleで作ったアカウントで、メールのコードでサインインして設定を開く。
    const user = await createGoogleLinkedUser({
      email: `google-created-${randomUUID()}@aims.test`,
      emailIdentity: false,
      googleEmail: `google-address-${randomUUID()}@aims.test`,
    });
    await signInByCodeAndOpenSettings(page, user.email);

    const panel = settingsPanel(page);
    await expect(panel.getByText(user.email)).toBeVisible();
    await expect(panel.getByText(user.googleEmail)).toBeVisible();
    await expect(googleRemoveButton(page)).toBeVisible();
  });

  test("設定の「追加」は、Googleの画面へ移り、取り消して戻ると、設定の分類「アカウント」が開いて追加されていない旨が示される", async ({
    page,
  }) => {
    // メールで作ったアカウントで設定を開き、「追加」を押してGoogleの画面へ移る。
    const google = await blockGoogle(page);
    const email = `link-cancel-${randomUUID()}@aims.test`;
    await signInByCodeAndOpenSettings(page, email);
    await googleAddButton(page).click();
    const authorization = await google.authorization();
    expect(google.requests).toHaveLength(1);

    // Googleの画面で取り消して、設定へ戻る。
    await returnCancelledFromGoogle(page, authorization);
    await expectAccountCategory(page);
    await expect(
      settingsPanel(page).getByText(authText("failure.google_link_cancelled")),
    ).toBeVisible();
    await expect(googleAddButton(page)).toBeVisible();
    expect(new URL(page.url()).search).toBe("");
    expect(
      (await page.context().cookies()).some(({ name }) => name === AUTH_COOKIE),
    ).toBe(true);
  });

  test("Googleを結び付けたアカウントは、確認して「削除」すると行が「追加」に変わり、メールのコードで再びサインインできる", async ({
    page,
  }) => {
    // Googleだけのアカウントで設定を開き、確認して「削除」する。
    const user = await createGoogleLinkedUser({
      email: `google-unlink-${randomUUID()}@aims.test`,
      emailIdentity: false,
    });
    await signInByCodeAndOpenSettings(page, user.email);
    await googleRemoveButton(page).click();
    await page
      .getByRole("dialog")
      .filter({ hasText: authText("linkGoogleConfirm") })
      .getByRole("button", { name: authText("linkGoogleRemove") })
      .click();
    await expect(googleAddButton(page)).toBeVisible();
    await expect(
      settingsPanel(page).getByText(authText("linkGoogleRemoved")),
    ).toBeVisible();

    // サインアウトして、メールのコードで再びサインインする。
    await signOutButton(page).click();
    await page
      .getByRole("button", { name: authText("signOutConfirmLabel") })
      .click();
    await expect(page).toHaveURL(/\/signin/);
    await signUpAndSignIn(page, {
      email: user.email,
      password: "unused-password1",
    });
    await expect(page).toHaveURL(/\/rounds/);
  });

  test("メールの手段を直接外そうとしても拒否され、Googleの手段は外せて、メールのコードでのサインインは変わらない", async () => {
    // メールとGoogleの手段を持つアカウントで、メールのコードでサインインする。
    const user = await createGoogleLinkedUser({
      email: `google-direct-${randomUUID()}@aims.test`,
      emailIdentity: true,
    });
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    try {
      const signedIn = await signInWithEmailOtp(client, user.email);
      expect(signedIn.error).toBeNull();
      const identities = (await client.auth.getUserIdentities()).data
        ?.identities;
      const emailIdentity = identities?.find(
        ({ provider }) => provider === "email",
      );
      const googleIdentity = identities?.find(
        ({ provider }) => provider === "google",
      );
      if (!emailIdentity || !googleIdentity)
        throw new Error("identities missing");

      // 認証サービスの手段の解除を直接呼ぶと、メールの手段は拒否され、Googleの手段は外せる。
      const emailUnlinked = await client.auth.unlinkIdentity(emailIdentity);
      expect(emailUnlinked.error?.status).toBe(500);
      const googleUnlinked = await client.auth.unlinkIdentity(googleIdentity);
      expect(googleUnlinked.error).toBeNull();

      // 別のクライアントでも、メールのコードでサインインできる。
      const other = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      try {
        const again = await signInWithEmailOtp(other, user.email);
        expect(again.error).toBeNull();
        expect(again.data.user?.id).toBe(user.id);
      } finally {
        await other.auth.stopAutoRefresh();
      }
    } finally {
      await client.auth.stopAutoRefresh();
    }
  });
});

test.describe("未認証", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const [name, path] of [
    ["サインイン", "/signin"],
    ["紹介", "/"],
    ["オフライン", "/offline"],
    ["見つからない旨", `/not-found-${randomUUID().slice(0, 8)}`],
  ] as const) {
    test(`${name}の画面に#settings/accountを付けても、パネルは開かない`, async ({
      page,
    }) => {
      await page.goto(`${path}${SETTINGS_ACCOUNT_HASH}`);
      await page.waitForLoadState("networkidle");

      await expect(settingsPanel(page)).toHaveCount(0);
    });
  }
});
