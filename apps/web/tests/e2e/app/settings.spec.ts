import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import {
  CHANGE_EMAIL_HASH,
  CHANGE_PASSWORD_HASH,
  DELETE_ACCOUNT_HASH,
  NEW_ROUND_PATH,
  ROUNDS_HISTORY_PATH,
  ROUNDS_HOME_PATH,
  SETTINGS_ACCOUNT_HASH,
} from "@/routes";
import { expect, test } from "../fixtures";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import { collectHydrationErrors } from "../helpers/hydration";
import { createRound } from "../helpers/rounds";
import {
  accountCategory,
  backgroundFab,
  closeButton,
  openHomeThenSettings,
  openSettingsByItem,
  pressAtCenter,
  settingsPanel,
} from "../helpers/settings";

const authText = translatorFor("auth");
const navigationText = translatorFor("navigation");
const settingsText = translatorFor("settings");

const MOBILE_VIEWPORT = { width: 375, height: 667 };
const WRONG_PASSWORD = "password-wrong1";

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
  await expect(backgroundFab(page)).toBeVisible();
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

    for (const screen of ["履歴", "作成", "詳細"] as const) {
      test(`${screen}の画面でも、「設定」項目から設定パネルを開ける`, async ({
        page,
      }) => {
        // ホームから、背景にする画面へ移る。
        await openHome(page);
        if (screen === "履歴") {
          await page
            .getByRole("link", { name: navigationText("leftPanelHistory") })
            .click();
          await expect(page).toHaveURL(
            new RegExp(`${ROUNDS_HISTORY_PATH}\\?return=1$`),
          );
        } else if (screen === "作成") {
          await backgroundFab(page).click();
          await expect(page).toHaveURL(new RegExp(`${NEW_ROUND_PATH}$`));
          await waitForHydration(page);
        } else {
          const roundId = await createRound({
            email: getSharedEmail(),
            password: SHARED_PASSWORD,
            name: "背景の詳細ラウンド",
            roundDate: "2026-08-24",
            distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
          });
          await page.goto(`/rounds/${roundId}`);
          await expect(page.getByTestId("round-config-summary")).toBeVisible();
        }
        const screenUrl = page.url();

        // 「設定」項目を押して、設定パネルが開く。
        await openSettingsByItem(page);
        await expect(page).toHaveURL(`${screenUrl}${SETTINGS_ACCOUNT_HASH}`);
      });
    }

    for (const [name, hash] of [
      ["分類", SETTINGS_ACCOUNT_HASH],
      ["メールアドレス変更", CHANGE_EMAIL_HASH],
      ["パスワード変更", CHANGE_PASSWORD_HASH],
      ["アカウント削除", DELETE_ACCOUNT_HASH],
    ] as const) {
      test(`ハッシュ${hash}で直接開く、または再読み込みすると、${name}の表示で開き、入力は空である`, async ({
        page,
      }) => {
        // ハッシュ付きで直接開いて、その表示のパネルが開く。
        const errors = collectHydrationErrors(page);
        await page.goto(`${ROUNDS_HOME_PATH}${hash}`);
        await expect(settingsPanel(page)).toBeVisible();
        await expectItemScreen(page, hash);

        // 再読み込みして、同じ表示で開く。
        await page.reload();
        await expect(settingsPanel(page)).toBeVisible();
        await expectItemScreen(page, hash);
        expect(errors, "ハイドレーションエラーがないこと").toEqual([]);
      });
    }

    for (const hash of ["#settings", "#settings/unknown"]) {
      test(`ハッシュ${hash}で開くと、分類「アカウント」として開き、履歴を増やさない`, async ({
        page,
      }) => {
        // 前の画面を開いた後に、ハッシュ付きで次の画面を開く。
        await openHome(page);
        await page.goto(`${NEW_ROUND_PATH}${hash}`);

        // 分類「アカウント」として開き、戻ると前の画面へ移る。
        await expect(settingsPanel(page)).toBeVisible();
        await expect(page).toHaveURL(
          new RegExp(`${NEW_ROUND_PATH}${SETTINGS_ACCOUNT_HASH}$`),
        );
        await expect(signOutButton(page)).toBeVisible();
        await page.goBack();
        await expect(page).toHaveURL(/\/rounds$/);
        await expect(backgroundFab(page)).toBeVisible();
      });
    }

    test("ハッシュ#settingsfooでは、パネルは開かず、ハッシュも変わらない", async ({
      page,
    }) => {
      await page.goto(`${ROUNDS_HOME_PATH}#settingsfoo`);
      await waitForHydration(page);

      await expect(settingsPanel(page)).toHaveCount(0);
      await expect(page).toHaveURL(/\/rounds#settingsfoo$/);
    });
  });

  test.describe("中を使う", () => {
    test("分類「アカウント」にメールアドレス変更・パスワード変更・アカウント削除・サインアウトがあり、レフトパネルにサインアウトのボタンは無く、本文に分類の見出しは無い", async ({
      page,
    }) => {
      await openHomeThenSettings(page);

      const panel = settingsPanel(page);
      for (const item of [
        "changeEmailItem",
        "changePasswordItem",
        "deleteAccountItem",
      ] as const) {
        await expect(
          panel.getByRole("link", { name: settingsText(item) }),
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
      ["changeEmailItem", "changeEmailTitle", CHANGE_EMAIL_HASH],
      ["changePasswordItem", "changePasswordTitle", CHANGE_PASSWORD_HASH],
      ["deleteAccountItem", "deleteAccountTitle", DELETE_ACCOUNT_HASH],
    ] as const) {
      test(`「${settingsText(item)}」項目を押すと、設定パネルの中に項目の画面が出て、URLが${hash}になる`, async ({
        page,
      }) => {
        await openHomeThenSettings(page);

        await settingsPanel(page)
          .getByRole("link", { name: settingsText(item) })
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
        .getByRole("link", { name: settingsText("changePasswordItem") })
        .click();
      await expect(page).toHaveURL(new RegExp(`${CHANGE_PASSWORD_HASH}$`));

      await accountCategory(page).click();

      await expect(page).toHaveURL(new RegExp(`${SETTINGS_ACCOUNT_HASH}$`));
      await expect(signOutButton(page)).toBeVisible();
    });

    test("設定パネルが開いている間、Tab・Shift+Tabを繰り返してもフォーカスが対話の外へ出ず、背景の操作は動作せず、外側の押下ではパネルが閉じるだけである", async ({
      page,
    }) => {
      // 設定パネルを開き、Tabを繰り返しても、フォーカスが対話の外へ出ない。
      await openHomeThenSettings(page);
      const focusState = () =>
        page.evaluate(() => ({
          inside:
            document.activeElement?.closest('[role="dialog"]') !== null &&
            document.activeElement !== document.body,
        }));
      for (const key of ["Tab", "Shift+Tab"]) {
        for (let i = 0; i < 20; i++) {
          await page.keyboard.press(key);
          // 囲い込みの端の見えない要素にフォーカスが一瞬届いても、対話の中へ戻される。
          await expect
            .poll(async () => (await focusState()).inside, {
              message: `${key} ${i}`,
            })
            .toBe(true);
        }
      }

      // 背景の「新規ラウンド」ボタンを座標で押すと、パネルが閉じるだけで、ボタンの動作は起きない。
      await pressAtCenter(page, backgroundFab(page));
      await expectClosedOnHome(page);
    });

    test("キーボードだけで、「設定」項目へTabで届き、Enterで開き、閉じる操作にフォーカスがあってEnterで閉じられる", async ({
      page,
    }) => {
      // 「設定」項目へTabで届き、Enterで開く。
      await openHome(page);
      const item = page.getByRole("link", {
        name: navigationText("leftPanelSettings"),
      });
      for (let i = 0; i < 30; i++) {
        if (await item.evaluate((el) => el === document.activeElement)) break;
        await page.keyboard.press("Tab");
      }
      await expect(item).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(settingsPanel(page)).toBeVisible();

      // 閉じる操作にフォーカスがあり、Enterで閉じられる。
      await expect(closeButton(page)).toBeFocused();
      await page.keyboard.press("Enter");
      await expectClosedOnHome(page);
    });
  });

  test.describe("ブラウザの戻る・進む", () => {
    test("項目で開き、メールアドレス変更へ移った後、戻るで分類へ、さらに戻ると閉じて開く前の画面が表示され、進むを2回押すと、分類、メールの順に開く", async ({
      page,
    }) => {
      // 項目で開き、メールアドレス変更へ移る。
      await openHomeThenSettings(page);
      await settingsPanel(page)
        .getByRole("link", { name: settingsText("changeEmailItem") })
        .click();
      await expect(page).toHaveURL(new RegExp(`${CHANGE_EMAIL_HASH}$`));

      // 戻るで分類へ、さらに戻るで閉じる。
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`${SETTINGS_ACCOUNT_HASH}$`));
      await expect(signOutButton(page)).toBeVisible();
      await page.goBack();
      await expectClosedOnHome(page);

      // 進むで分類、メールの順に開く。
      await page.goForward();
      await expect(page).toHaveURL(new RegExp(`${SETTINGS_ACCOUNT_HASH}$`));
      await expect(signOutButton(page)).toBeVisible();
      await page.goForward();
      await expect(page).toHaveURL(new RegExp(`${CHANGE_EMAIL_HASH}$`));
      await expect(
        settingsPanel(page).getByRole("heading", {
          name: authText("changeEmailTitle"),
        }),
      ).toBeVisible();
    });

    test("読み込み時に開いたパネルで、分類からメールへ移った後、戻るで分類へ、さらに戻ると、読み込みより前の画面へ移る", async ({
      page,
    }) => {
      // 前の画面を開いた後、パネルを開いたまま次の画面を読み込む。
      await page.goto(NEW_ROUND_PATH);
      await waitForHydration(page);
      await page.goto(`${ROUNDS_HOME_PATH}${SETTINGS_ACCOUNT_HASH}`);
      await expect(settingsPanel(page)).toBeVisible();
      await settingsPanel(page)
        .getByRole("link", { name: settingsText("changeEmailItem") })
        .click();
      await expect(page).toHaveURL(new RegExp(`${CHANGE_EMAIL_HASH}$`));

      // 戻るで分類へ移り、さらに戻ると、読み込みより前の画面へ移る。
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`${SETTINGS_ACCOUNT_HASH}$`));
      await expect(signOutButton(page)).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`${NEW_ROUND_PATH}$`));
      await expect(settingsPanel(page)).toHaveCount(0);
    });
  });

  test.describe("閉じる", () => {
    test("開く前の画面から開き、中で2回移動した後に閉じる操作で閉じると、URLは開く前の画面になり、戻るを押してもパネルは開かず、さらに前の画面へ移る", async ({
      page,
    }) => {
      // 1画面前を作り、ホームから設定パネルを開いて、中で2回移動する。
      await page.goto(NEW_ROUND_PATH);
      await waitForHydration(page);
      await openHome(page);
      await openSettingsByItem(page);
      await settingsPanel(page)
        .getByRole("link", { name: settingsText("changeEmailItem") })
        .click();
      await settingsPanel(page)
        .getByRole("link", { name: authText("back") })
        .click();
      await expect(page).toHaveURL(new RegExp(`${SETTINGS_ACCOUNT_HASH}$`));

      // 閉じる操作で閉じ、戻ると、パネルは開かず、さらに前の画面へ移る。
      await closeButton(page).click();
      await expectClosedOnHome(page);
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`${NEW_ROUND_PATH}$`));
      await expect(settingsPanel(page)).toHaveCount(0);
    });

    test("読み込み時に開いたパネルで、中で2回移動した後に閉じると、ハッシュが外れて背景の画面が表示され、戻るを押すと読み込みより前の画面へ移り、パネルは開かない", async ({
      page,
    }) => {
      // 1画面前を作り、パネルを開いたまま読み込んで、中で2回移動する。
      await page.goto(NEW_ROUND_PATH);
      await waitForHydration(page);
      await page.goto(`${ROUNDS_HOME_PATH}${SETTINGS_ACCOUNT_HASH}`);
      await expect(settingsPanel(page)).toBeVisible();
      await settingsPanel(page)
        .getByRole("link", { name: settingsText("changeEmailItem") })
        .click();
      await settingsPanel(page)
        .getByRole("link", { name: authText("back") })
        .click();
      await expect(page).toHaveURL(new RegExp(`${SETTINGS_ACCOUNT_HASH}$`));

      // 閉じて背景の画面が表示され、戻ると読み込みより前の画面へ移る。
      await closeButton(page).click();
      await expectClosedOnHome(page);
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`${NEW_ROUND_PATH}$`));
      await expect(settingsPanel(page)).toHaveCount(0);
    });

    for (const how of ["閉じる操作", "Esc", "外側の押下"] as const) {
      test(`${how}で閉じると、背景の画面が表示される`, async ({ page }) => {
        await openHomeThenSettings(page);

        if (how === "閉じる操作") await closeButton(page).click();
        else if (how === "Esc") await page.keyboard.press("Escape");
        else await pressAtCenter(page, backgroundFab(page));

        await expectClosedOnHome(page);
      });
    }

    test("幅768px未満では、ドロワーから「設定」項目を押して開き、閉じる操作とEscで閉じる", async ({
      page,
    }) => {
      // 狭い画面で、ドロワーを展開して「設定」項目を押し、設定パネルを開く。
      await page.setViewportSize(MOBILE_VIEWPORT);
      await openHome(page);
      await openDrawerThenSettings(page);

      // 閉じる操作で閉じ、もう一度開いてEscで閉じる。
      await closeButton(page).click();
      await expect(settingsPanel(page)).toBeHidden();
      await openDrawerThenSettings(page);
      await page.keyboard.press("Escape");
      await expect(settingsPanel(page)).toBeHidden();
    });
  });

  test.describe("閉じた後のフォーカス", () => {
    test("幅768px以上で列が開いているとき、「設定」項目で開いて閉じると、列の「設定」項目にフォーカスが戻り、列は開いたままである", async ({
      page,
    }) => {
      await openHomeThenSettings(page);

      await closeButton(page).click();

      await expect(settingsPanel(page)).toBeHidden();
      await expect(
        page.getByRole("link", {
          name: navigationText("leftPanelSettings"),
          exact: true,
        }),
      ).toBeFocused();
      await expect(
        page.getByRole("button", {
          name: navigationText("leftPanelCloseMenu"),
        }),
      ).toBeVisible();
    });

    test("幅768px以上で列が閉じているとき、ブラウザの戻るで閉じると、ヘッダーのメニューボタンにフォーカスが戻り、列は閉じたままである", async ({
      page,
    }) => {
      // 列を閉じ、列が閉じたままアドレス欄のようにハッシュを書き換えてパネルを開く。
      await openHome(page);
      await page
        .getByRole("button", { name: navigationText("leftPanelCloseMenu") })
        .click();
      const menuButton = page.getByRole("button", {
        name: navigationText("leftPanelOpenMenu"),
      });
      await expect(menuButton).toBeVisible();
      await page.evaluate((hash) => {
        window.location.hash = hash;
      }, SETTINGS_ACCOUNT_HASH);
      await expect(settingsPanel(page)).toBeVisible();

      // 戻るで閉じて、ヘッダーのメニューボタンへフォーカスが戻る。
      await page.goBack();
      await expect(settingsPanel(page)).toBeHidden();
      await expect(menuButton).toBeFocused();
      await expect(menuButton).toBeVisible();
    });

    test("幅768px未満で、ドロワーから開いて閉じると、ヘッダーのメニューボタンにフォーカスが戻り、ドロワーは閉じたままである", async ({
      page,
    }) => {
      await page.setViewportSize(MOBILE_VIEWPORT);
      await openHome(page);
      await openDrawerThenSettings(page);

      await closeButton(page).click();

      await expect(settingsPanel(page)).toBeHidden();
      const menuButton = page.getByRole("button", {
        name: navigationText("leftPanelOpenMenu"),
      });
      await expect(menuButton).toBeFocused();
      await expect(
        page.getByRole("link", {
          name: navigationText("leftPanelSettings"),
          exact: true,
        }),
      ).toHaveCount(0);
    });

    test("読み込み時に開いたパネルを閉じると、フォーカスは背景の画面の先頭(本文領域)に移る", async ({
      page,
    }) => {
      await page.goto(`${ROUNDS_HOME_PATH}${SETTINGS_ACCOUNT_HASH}`);
      await expect(settingsPanel(page)).toBeVisible();

      await closeButton(page).click();

      await expect(settingsPanel(page)).toBeHidden();
      await expect
        .poll(() =>
          page.evaluate(() => {
            const active = document.activeElement;
            const main = document.querySelector("main");
            return (
              active !== null &&
              active !== document.body &&
              main !== null &&
              active.contains(main)
            );
          }),
        )
        .toBe(true);
    });

    test("ブラウザの戻るで閉じても(読み込み後に開いたパネル)、フォーカスは開き口へ移る", async ({
      page,
    }) => {
      await openHomeThenSettings(page);

      await page.goBack();

      await expect(settingsPanel(page)).toBeHidden();
      await expect(
        page.getByRole("link", {
          name: navigationText("leftPanelSettings"),
          exact: true,
        }),
      ).toBeFocused();
    });
  });

  test.describe("処理中", () => {
    // パスワード変更の更新の要求を保留する。誤った現在のパスワードを送るため、解くと認証サービスが拒否し、共有の認証状態のパスワードは変わらない。
    async function holdPasswordUpdate(page: Page) {
      const held = Promise.withResolvers<void>();
      await page.route("**/auth/v1/user", async (route) => {
        if (route.request().method() !== "PUT") return route.continue();
        await held.promise;
        await route.continue();
      });
      return held.resolve;
    }

    async function submitWrongPassword(page: Page) {
      const panel = settingsPanel(page);
      await panel
        .getByPlaceholder(authText("changePasswordCurrentPlaceholder"))
        .fill(WRONG_PASSWORD);
      await panel
        .getByPlaceholder(authText("changePasswordNewPlaceholder"), {
          exact: true,
        })
        .fill("password-changed1");
      await panel
        .getByRole("button", { name: authText("changePasswordSubmit") })
        .click();
      await expect(
        panel.getByRole("button", { name: authText("changePasswordSubmit") }),
      ).toHaveAttribute("aria-disabled", "true");
    }

    test("処理中は、閉じる操作・Esc・外側の押下・分類の選択・戻るのいずれも受け付けず、パネルは実行中のままで、応答を返すと再び受け付ける", async ({
      page,
    }) => {
      // パスワード変更の画面で、更新の応答を保留する。
      await openHomeThenSettings(page);
      await settingsPanel(page)
        .getByRole("link", { name: settingsText("changePasswordItem") })
        .click();
      const release = await holdPasswordUpdate(page);
      await submitWrongPassword(page);

      // どの閉じる・移る操作も受け付けず、パネルは実行中のままである。
      await expect(closeButton(page)).toBeDisabled();
      await page.keyboard.press("Escape");
      await pressAtCenter(page, backgroundFab(page));
      await accountCategory(page).click({ force: true });
      await settingsPanel(page)
        .getByRole("link", { name: authText("back") })
        .or(settingsPanel(page).getByText(authText("back")))
        .first()
        .click({ force: true });
      await expect(settingsPanel(page)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${CHANGE_PASSWORD_HASH}$`));

      // 応答を返すと、拒否の表示の後、分類の選択を受け付ける。
      release();
      await expect(
        settingsPanel(page).getByText(
          authText("failure.current_password_invalid"),
        ),
      ).toBeVisible();
      await accountCategory(page).click();
      await expect(page).toHaveURL(new RegExp(`${SETTINGS_ACCOUNT_HASH}$`));
    });

    test("処理中に項目からブラウザの戻るを押すと、ハッシュが変わって分類へ移り、保留していた応答を返しても、表示も移動も起きない", async ({
      page,
    }) => {
      // 項目の画面で、更新の応答を保留する。
      await openHomeThenSettings(page);
      await settingsPanel(page)
        .getByRole("link", { name: settingsText("changePasswordItem") })
        .click();
      const release = await holdPasswordUpdate(page);
      await submitWrongPassword(page);

      // 戻るで分類へ移る。
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`${SETTINGS_ACCOUNT_HASH}$`));
      await expect(signOutButton(page)).toBeVisible();

      // 応答を返しても、表示も移動も起きない。
      release();
      await expect(
        page.getByText(authText("failure.current_password_invalid")),
      ).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`${SETTINGS_ACCOUNT_HASH}$`));
      await expect(signOutButton(page)).toBeVisible();
    });

    test("処理中にブラウザの戻るでパネルが閉じても、保留していた応答を返したとき、表示も移動も起きない", async ({
      page,
    }) => {
      // アドレス欄のようにハッシュを書き換えて項目の画面を開き、更新の応答を保留する。
      await openHome(page);
      await page.evaluate((hash) => {
        window.location.hash = hash;
      }, CHANGE_PASSWORD_HASH);
      await expect(settingsPanel(page)).toBeVisible();
      const release = await holdPasswordUpdate(page);
      await submitWrongPassword(page);

      // 戻るでパネルが閉じる。
      await page.goBack();
      await expectClosedOnHome(page);

      // 応答を返しても、表示も移動も起きない。
      release();
      await expect(
        page.getByText(authText("failure.current_password_invalid")),
      ).toHaveCount(0);
      await expectClosedOnHome(page);
    });
  });
});

test.describe("未認証", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const [name, path] of [
    ["サインイン", "/signin"],
    ["サインアップ", "/signup"],
    ["パスワード再設定", "/reset-password"],
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

// 項目の画面の入力が空であることを確かめる(分類は、サインアウトの行がある)。
async function expectItemScreen(page: Page, hash: string) {
  const panel = settingsPanel(page);
  if (hash === SETTINGS_ACCOUNT_HASH) {
    await expect(signOutButton(page)).toBeVisible();
  } else if (hash === CHANGE_EMAIL_HASH) {
    await expect(
      panel.getByPlaceholder(authText("changeEmailNewPlaceholder")),
    ).toHaveValue("");
  } else if (hash === CHANGE_PASSWORD_HASH) {
    await expect(
      panel.getByPlaceholder(authText("changePasswordCurrentPlaceholder")),
    ).toHaveValue("");
  } else {
    await expect(
      panel.getByPlaceholder(authText("deleteAccountPasswordPlaceholder")),
    ).toHaveValue("");
  }
}

// 幅768px未満で、ヘッダーのメニューボタンでドロワーを展開し、「設定」項目を押して、設定パネルを開く。
async function openDrawerThenSettings(page: Page) {
  await page
    .getByRole("button", { name: navigationText("leftPanelOpenMenu") })
    .click();
  await openSettingsByItem(page);
}
