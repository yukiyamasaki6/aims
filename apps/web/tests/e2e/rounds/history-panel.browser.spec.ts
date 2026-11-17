import { expect, type Page, test } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";

const t = translatorFor("rounds");
const toggle = (page: Page) => page.getByTestId("history-controls-toggle");
const panel = (page: Page) =>
  page.getByRole("region", { name: t("historyFilterTitle") });
const action = (page: Page, name: "apply" | "reset") =>
  page.getByTestId(`history-controls-${name}`);
const closeButton = (page: Page) => page.getByTestId("history-filter-close");
// アクセシビリティツリー上のボタン。閉じている間は`aria-hidden`で除かれる。
const closeInTree = (page: Page) =>
  page.getByRole("button", { name: t("historyFilterClose"), exact: true });
const PORTRAIT = { width: 375, height: 667 };
const LANDSCAPE = { width: 800, height: 360 };
const score = (page: Page) => page.getByTestId("history-filter-scoreMin");

// ブラウザ結合のみ。実認証・DBを通す主要E2Eはhistory.spec.tsが担当する。
test.beforeEach(async ({ page, context }) => {
  const payload = {
    sub: "11111111-1111-4111-8111-111111111111",
    aud: "authenticated",
    role: "authenticated",
    exp: 4_102_444_800,
  };
  const jwt = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.test-signature`;
  const session = {
    access_token: jwt,
    refresh_token: "browser-test-refresh",
    expires_at: payload.exp,
    expires_in: 3600,
    token_type: "bearer",
    user: { id: payload.sub },
  };
  await context.addCookies([
    {
      name: "sb-localhost-auth-token",
      value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
      domain: "localhost",
      path: "/",
    },
  ]);
  await page.route("**/supabase-api/rest/v1/**", async (route) => {
    const url = route.request().url();
    const data = url.includes("/rpc/rounds_list")
      ? [
          {
            id: "22222222-2222-4222-8222-222222222222",
            name: "ブラウザ結合の完了ラウンド",
            round_date: "2026-09-15",
            format: "outdoor",
            bow_type: "recurve",
            total: 300,
            distances: [{ distance: 70, is_marked: true, total: 300 }],
          },
        ]
      : [];
    await route.fulfill({
      json: url.includes("/rpc/rounds_list")
        ? { rounds: data, has_more: false }
        : data,
    });
  });
  await page.goto("/rounds/history");
  await expect(toggle(page)).toBeVisible();
});

async function openFilter(page: Page) {
  await toggle(page).click();
  await expect(panel(page)).toBeVisible();
}

async function makeError(page: Page) {
  await score(page).fill("-");
  await action(page, "apply").click();
  await expect(
    page.getByTestId("history-filter-error-scoreInvalid"),
  ).toBeVisible();
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 800, height: 360 },
]) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test("開くと表示単位の選択中の項目へ移り、Tabで一覧へ移動でき、一覧のEscとクリックで編集を失わない", async ({
      page,
    }) => {
      await openFilter(page);
      await expect(page.getByTestId("history-unit-round")).toBeFocused();
      await makeError(page);
      const link = page.getByRole("main").getByRole("link").first();
      await link.focus();
      await page.keyboard.press("Escape");
      await page.getByRole("heading", { level: 1 }).click();
      await expect(panel(page)).toBeVisible();
      await expect(score(page)).toHaveValue("-");
      await expect(
        page.getByTestId("history-filter-error-scoreInvalid"),
      ).toBeVisible();
      await action(page, "reset").focus();
      await page.keyboard.press("Shift+Tab");
      // 実際のTab順を通して一覧へ到達する。位置・寸法は期待値にしない。
      let reached = false;
      for (let i = 0; i < 30 && !reached; i++) {
        await page.keyboard.press("Tab");
        reached = await link.evaluate(
          (element) => element === document.activeElement,
        );
      }
      expect(reached).toBe(true);
    });

    test("リセットは下書きだけを戻し、入力中のEnterでは検索せず、ページ遷移もしない", async ({
      page,
    }) => {
      await page.evaluate(() => {
        (window as unknown as { marker: string }).marker = "kept";
      });
      await openFilter(page);
      await makeError(page);
      await action(page, "reset").click();
      await expect(score(page)).toHaveValue("");
      await expect(
        page.getByTestId("history-controls").getByRole("alert"),
      ).toHaveCount(0);
      await expect(panel(page)).toBeVisible();
      const requests: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/rpc/rounds_list"))
          requests.push(request.url());
      });
      await score(page).fill("100");
      await score(page).press("Enter");
      await expect(panel(page)).toBeVisible();
      await expect(page.getByTestId("history-controls-active")).toHaveCount(0);
      expect(requests).toEqual([]);
      expect(
        await page.evaluate(
          () => (window as unknown as { marker?: string }).marker,
        ),
      ).toBe("kept");
    });

    test("検索は向きに応じて、縦長では閉じてフィルターへフォーカスを戻し、横長では開いたまま検索にフォーカスを残す", async ({
      page,
    }) => {
      const portrait = viewport.height > viewport.width;
      await openFilter(page);
      await score(page).fill("100");
      await action(page, "apply").click();
      await expect(page.getByTestId("history-controls-active")).toBeVisible();
      if (portrait) {
        await expect(panel(page)).toBeHidden();
        await expect(toggle(page)).toBeFocused();
      } else {
        await expect(panel(page)).toBeVisible();
        await expect(score(page)).toHaveValue("100");
        await expect(action(page, "apply")).toBeFocused();
      }
      await openFilterIfClosed(page);
      await expect(score(page)).toHaveValue("100");
    });

    test("ヘッダーのフィルターで閉じ、閉じる直後から入力と操作行がTabの対象外で、開き直しても未適用値を持ち越さない", async ({
      page,
    }) => {
      await openFilter(page);
      await score(page).fill("123");
      await toggle(page).click();
      await expect(panel(page)).toBeHidden();
      await expect(toggle(page)).toBeFocused();
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("Tab");
        expect(
          await page
            .locator(
              "[data-testid=history-controls], [data-testid^=history-controls-]",
            )
            .evaluateAll((elements) =>
              elements.some(
                (element) =>
                  element.getAttribute("data-testid") !==
                    "history-controls-toggle" &&
                  element.getAttribute("data-testid") !==
                    "history-controls-active" &&
                  element.contains(document.activeElement),
              ),
            ),
        ).toBe(false);
      }
      await openFilter(page);
      await expect(score(page)).toHaveValue("");
    });

    test("開閉の状態がヘッダーのボタンと名前付きregionで対応し、下部の行のリセット・検索は1組だけである", async ({
      page,
    }) => {
      await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
      await expect(panel(page)).toBeHidden();
      await openFilter(page);
      await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
      const id = await panel(page).getAttribute("id");
      await expect(toggle(page)).toHaveAttribute("aria-controls", id ?? "");
      await expect(action(page, "apply")).toHaveCount(1);
      await expect(action(page, "reset")).toHaveCount(1);
      await expect(
        panel(page).getByRole("button", { name: t("historyControlsApply") }),
      ).toBeVisible();
    });

    test("開くと閉じるボタンが先頭の行の操作として表示単位の次にキーボードで届き、Enterで閉じて未適用値を破棄しフォーカスがフィルターへ戻る", async ({
      page,
    }) => {
      await openFilter(page);
      await expect(
        panel(page).getByRole("button", { name: t("historyFilterClose") }),
      ).toHaveCount(1);
      await score(page).fill("123");
      await page.getByTestId("history-unit-round").focus();
      await page.keyboard.press("Tab");
      await expect(closeButton(page)).toBeFocused();

      await page.keyboard.press("Enter");
      await expect(panel(page)).toBeHidden();
      await expect(toggle(page)).toBeFocused();
      await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
      await openFilter(page);
      await expect(score(page)).toHaveValue("");
    });

    test("閉じている間は閉じるボタンが見えずTabでも届かず、開くと届く", async ({
      page,
    }) => {
      const reachedByTab = async () => {
        for (let i = 0; i < 6; i++) {
          await page.keyboard.press("Tab");
          if (
            await page.evaluate(
              () =>
                document.activeElement?.getAttribute("data-testid") ===
                "history-filter-close",
            )
          )
            return true;
        }
        return false;
      };
      await expect(closeInTree(page)).toHaveCount(0);
      await toggle(page).focus();
      expect(await reachedByTab()).toBe(false);

      await openFilter(page);
      await toggle(page).click();
      await expect(panel(page)).toBeHidden();
      await expect(closeInTree(page)).toHaveCount(0);
      await toggle(page).focus();
      expect(await reachedByTab()).toBe(false);

      await openFilter(page);
      await expect(closeInTree(page)).toHaveCount(1);
      await expect(closeButton(page)).toBeVisible();
    });

    for (const route of ["漏斗の再押下", "閉じるボタン", "Esc"] as const) {
      test(`${route}で閉じると、未適用値とエラーを破棄し、漏斗へフォーカスが戻り、aria-expandedが偽に戻る`, async ({
        page,
      }) => {
        await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
        await openFilter(page);
        await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
        await makeError(page);

        if (route === "漏斗の再押下") await toggle(page).click();
        if (route === "閉じるボタン") await closeButton(page).click();
        if (route === "Esc") await score(page).press("Escape");
        await expect(panel(page)).toBeHidden();
        await expect(toggle(page)).toBeFocused();
        await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
        await expect(page.getByTestId("history-controls-active")).toHaveCount(
          0,
        );
        await openFilter(page);
        await expect(score(page)).toHaveValue("");
        await expect(
          page.getByTestId("history-filter-error-scoreInvalid"),
        ).toHaveCount(0);
      });
    }

    test("検索で閉じる向きでは、閉じるとaria-expandedが偽に戻り、開いたままの向きでは真のまま続く", async ({
      page,
    }) => {
      const portrait = viewport.height > viewport.width;
      await openFilter(page);
      await score(page).fill("100");
      await action(page, "apply").click();
      await expect(toggle(page)).toHaveAttribute(
        "aria-expanded",
        portrait ? "false" : "true",
      );
    });

    test("検索した後に別の値を未適用で編集して閉じるボタンで閉じると、検索した条件は残り未適用の値だけを破棄する", async ({
      page,
    }) => {
      const portrait = viewport.height > viewport.width;
      await openFilter(page);
      await score(page).fill("100");
      await action(page, "apply").click();
      if (portrait) await openFilter(page);
      await score(page).fill("200");

      await closeButton(page).click();
      await expect(panel(page)).toBeHidden();
      await expect(toggle(page)).toBeFocused();
      await expect(page.getByTestId("history-controls-active")).toBeVisible();
      await openFilter(page);
      await expect(score(page)).toHaveValue("100");
    });

    test("パネル内のEscは閉じてフィルターへ戻るが、ヘッダーのフィルター上のEscは閉じない", async ({
      page,
    }) => {
      await openFilter(page);
      await makeError(page);
      await toggle(page).focus();
      await page.keyboard.press("Escape");
      await expect(panel(page)).toBeVisible();
      await expect(score(page)).toHaveValue("-");
      await score(page).focus();
      await page.keyboard.press("Escape");
      await expect(panel(page)).toBeHidden();
      await expect(toggle(page)).toBeFocused();
    });
  });
}

async function openFilterIfClosed(page: Page) {
  if (await panel(page).isHidden()) await openFilter(page);
}

test("格納の途中で開き直しても、古い編集は戻らず新しい編集と検索ができる", async ({
  page,
}) => {
  await page.setViewportSize(PORTRAIT);
  await page.clock.install();
  await openFilter(page);
  await score(page).fill("19");
  await toggle(page).click();
  await toggle(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(score(page)).toHaveValue("");
  await score(page).fill("25");
  // 古い編集の格納終了の通知を、再表示の後で届かせる。
  await page.clock.runFor(400);
  await expect(panel(page)).toBeVisible();
  await expect(score(page)).toHaveValue("25");
  await action(page, "apply").click();
  await expect(panel(page)).toBeHidden();
  await openFilter(page);
  await expect(score(page)).toHaveValue("25");
});

test("横長で検索を重ねても、パネルを開いたままTabとEnterで再検索でき、Escで直近の検索条件へ戻る", async ({
  page,
}) => {
  await page.setViewportSize(LANDSCAPE);
  await openFilter(page);
  await score(page).fill("100");
  await action(page, "apply").click();
  await score(page).fill("200");
  await action(page, "apply").focus();
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();
  await expect(action(page, "apply")).toBeFocused();
  await score(page).fill("300");
  await score(page).press("Escape");
  await expect(panel(page)).toBeHidden();
  await openFilter(page);
  await expect(score(page)).toHaveValue("200");
});

for (const [start, end] of [
  [PORTRAIT, LANDSCAPE],
  [LANDSCAPE, PORTRAIT],
] as const) {
  test(`向きを ${start.width}→${end.width} へ変えてから検索すると、変えた後の向きの挙動になる`, async ({
    page,
  }) => {
    await page.setViewportSize(start);
    await openFilter(page);
    await score(page).fill("100");
    await action(page, "apply").focus();
    await page.setViewportSize(end);
    await expect(panel(page)).toBeVisible();
    await expect(action(page, "apply")).toBeFocused();
    await action(page, "apply").click();
    if (end.width === LANDSCAPE.width) {
      await expect(panel(page)).toBeVisible();
      await expect(action(page, "apply")).toBeFocused();
    } else {
      await expect(panel(page)).toBeHidden();
      await expect(toggle(page)).toBeFocused();
    }
  });
}

for (const [start, end] of [
  [
    { width: 375, height: 667 },
    { width: 800, height: 360 },
  ],
  [
    { width: 800, height: 360 },
    { width: 375, height: 667 },
  ],
  [
    { width: 600, height: 601 },
    { width: 600, height: 600 },
  ],
  [
    { width: 600, height: 600 },
    { width: 600, height: 599 },
  ],
] as const) {
  test(`回転 ${start.width}×${start.height}→${end.width}×${end.height} で文字とエラーを保持する`, async ({
    page,
  }) => {
    await page.setViewportSize(start);
    await openFilter(page);
    await makeError(page);
    await score(page).focus();
    await page.setViewportSize(end);
    await expect(score(page)).toBeFocused();
    await expect(score(page)).toHaveValue("-");
    await expect(
      page.getByTestId("history-filter-error-scoreInvalid"),
    ).toBeVisible();
    await expect(action(page, "apply")).toHaveCount(1);
    await expect(action(page, "reset")).toHaveCount(1);
    await action(page, "reset").click();
    await expect(score(page)).toHaveValue("");
  });
}

test("距離と的のPortalでEscが一段ずつ閉じて入力へ戻る", async ({ page }) => {
  await openFilter(page);
  await makeError(page);
  const add = page.getByTestId("history-filter-distance-add");
  await add.click();
  await page.getByTestId("history-distance-dialog-distance").fill("50");
  await page.getByTestId("history-distance-dialog-target").click();
  await expect(
    page.getByTestId("history-distance-dialog-target-none"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByTestId("history-distance-dialog-target-none"),
  ).toBeHidden();
  await expect(
    page.getByTestId("history-distance-dialog-distance"),
  ).toHaveValue("50");
  await page.keyboard.press("Escape");
  await expect(
    page.getByTestId("history-distance-dialog-confirm"),
  ).toBeHidden();
  await expect(add).toBeFocused();
  await expect(panel(page)).toBeVisible();
  await expect(score(page)).toHaveValue("-");
});

test("SelectのEscは選択肢だけを閉じて外側の編集を保持する", async ({
  page,
}) => {
  await openFilter(page);
  await makeError(page);
  await page.getByTestId("history-filter-format").click();
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
  await expect(score(page)).toHaveValue("-");
});

test("動きを減らす設定で閉じて次の編集と検索ができる", async ({ page }) => {
  await page.setViewportSize(PORTRAIT);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openFilter(page);
  await score(page).fill("123");
  await score(page).press("Escape");
  await expect(panel(page)).toBeHidden();
  await openFilter(page);
  await expect(score(page)).toHaveValue("");
  await score(page).fill("25");
  await action(page, "apply").click();
  await expect(panel(page)).toBeHidden();
  await openFilter(page);
  await expect(score(page)).toHaveValue("25");
});

for (const [start, end] of [
  [
    { width: 375, height: 667 },
    { width: 800, height: 360 },
  ],
  [
    { width: 800, height: 360 },
    { width: 375, height: 667 },
  ],
] as const) {
  for (const name of ["apply", "reset"] as const) {
    test(`回転 ${start.width}→${end.width} で${name}のフォーカスは動かない`, async ({
      page,
    }) => {
      await page.setViewportSize(start);
      await openFilter(page);
      await action(page, name).focus();
      await page.setViewportSize(end);
      await expect(action(page, name)).toBeFocused();
      await expect(panel(page)).toBeVisible();
    });
  }
  for (const state of ["input", "error", "target"] as const) {
    test(`回転 ${start.width}→${end.width} で距離の${state}を保持する`, async ({
      page,
    }) => {
      await page.setViewportSize(start);
      await openFilter(page);
      await page.getByTestId("history-filter-distance-add").click();
      const distance = page.getByTestId("history-distance-dialog-distance");
      await distance.fill(state === "error" ? "0" : "50");
      await page.getByTestId("history-distance-dialog-arrowsPerEnd").fill("6");
      if (state === "error") {
        await page.getByTestId("history-distance-dialog-confirm").click();
        await expect(
          page.getByTestId("history-distance-dialog-error-distanceInvalid"),
        ).toBeVisible();
      }
      if (state === "target") {
        await page.getByTestId("history-distance-dialog-target").click();
        await expect(
          page.getByTestId("history-distance-dialog-target-none"),
        ).toBeVisible();
      } else {
        await distance.focus();
      }
      await page.setViewportSize(end);
      await expect(distance).toHaveValue(state === "error" ? "0" : "50");
      await expect(
        page.getByTestId("history-distance-dialog-arrowsPerEnd"),
      ).toHaveValue("6");
      if (state === "error")
        await expect(
          page.getByTestId("history-distance-dialog-error-distanceInvalid"),
        ).toBeVisible();
      if (state === "target")
        await expect(
          page.getByTestId("history-distance-dialog-target-none"),
        ).toBeVisible();
      else await expect(distance).toBeFocused();
    });
  }
}

for (const target of [
  "history-filter-bow-type",
  "history-unit-distance",
  "history-filter-scoreMin",
] as const) {
  test(`Selectを開いたまま${target}を押して編集を続けられる`, async ({
    page,
  }) => {
    await openFilter(page);
    await page.getByTestId("history-filter-format").click();
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.getByTestId(target).click();
    if (target === "history-filter-bow-type") {
      await expect(
        page.getByRole("option", {
          name: t("bowTypeOption.recurve"),
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole("option", { name: t("bowTypeOption.recurve"), exact: true })
        .click();
      await expect(page.getByTestId(target)).toHaveText(
        t("bowTypeOption.recurve"),
      );
    } else if (target === "history-unit-distance") {
      await expect(page.getByTestId(target)).toHaveAttribute(
        "aria-checked",
        "true",
      );
    } else {
      await score(page).fill("25");
      await expect(score(page)).toHaveValue("25");
    }
    await expect(panel(page)).toBeVisible();
  });
}

test("編集・回転・開閉・同値検索は履歴を再取得せず適用値を再読み込みで保持する", async ({
  page,
}) => {
  await page.setViewportSize(PORTRAIT);
  await expect(page.getByRole("listitem")).toHaveCount(1);
  const requests: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/rpc/rounds_list"))
      requests.push(request.postDataJSON());
  });
  await openFilter(page);
  await makeError(page);
  await page.setViewportSize(LANDSCAPE);
  await page.setViewportSize(PORTRAIT);
  await action(page, "reset").click();
  await action(page, "apply").click();
  await expect(panel(page)).toBeHidden();
  expect(requests).toEqual([]);
  await openFilter(page);
  await score(page).fill("100");
  await action(page, "apply").click();
  await expect(panel(page)).toBeHidden();
  await expect
    .poll(() => requests)
    .toContainEqual(expect.objectContaining({ p_score_min: 100 }));
  await openFilter(page);
  await makeError(page);
  await page.reload();
  await expect(toggle(page)).toBeVisible();
  await expect(panel(page)).toBeHidden();
  await openFilter(page);
  await expect(score(page)).toHaveValue("100");
  await expect(
    page.getByTestId("history-filter-error-scoreInvalid"),
  ).toHaveCount(0);
});

test("開閉・回転後も一覧をスクロールして続きを重複なく取得し終端で止まる", async ({
  page,
}) => {
  const firstPages: unknown[] = [];
  const requests: unknown[] = [];
  await page.route("**/supabase-api/rest/v1/rpc/rounds_list", async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (body.p_after_id === null) firstPages.push(body);
    const start = body.p_after_id ? Number(body.p_after_id.slice(-12)) : 0;
    const end = Math.min(start + body.p_limit, 60);
    await route.fulfill({
      json: {
        rounds: Array.from({ length: end - start }, (_, offset) => {
          const index = start + offset + 1;
          return {
            id: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
            name: `継続取得-${index}`,
            round_date: "2026-09-15",
            format: "outdoor",
            bow_type: "recurve",
            total: 300,
            distances: [{ distance: 70, is_marked: true, total: 300 }],
          };
        }),
        has_more: end < 60,
      },
    });
  });
  // 一覧の途中を表示してフィルターの編集へ進む。
  await page.reload();
  await expect(page.getByText("継続取得-1", { exact: true })).toBeVisible();
  const middle = page.getByText("継続取得-6", { exact: true });
  await middle.scrollIntoViewIfNeeded();
  await openFilter(page);
  await toggle(page).click();
  await expect(panel(page)).toBeHidden();
  await expect(middle).toBeInViewport();

  // 回転後も末尾へ移動して全件を読み進める。
  await page.setViewportSize({ width: 800, height: 360 });
  await expect(async () => {
    await page.getByRole("listitem").last().scrollIntoViewIfNeeded();
    await expect(page.getByText("継続取得-60", { exact: true })).toBeVisible({
      timeout: 500,
    });
  }).toPass();
  await expect(page.getByText(t("historyEnd"))).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(60);
  expect(firstPages).toHaveLength(1);
  const before = requests.length;
  await page.getByRole("listitem").last().scrollIntoViewIfNeeded();
  await openFilter(page);
  await toggle(page).click();
  await expect(panel(page)).toBeHidden();
  expect(requests).toHaveLength(before);
});

for (const viewport of [PORTRAIT, LANDSCAPE]) {
  test(`${viewport.width}×${viewport.height}で一覧をスクロールしても編集を失わず、フィルターが隠れず押して開閉できる`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.route(
      "**/supabase-api/rest/v1/rpc/rounds_list",
      async (route) => {
        await route.fulfill({
          json: {
            rounds: Array.from({ length: 12 }, (_, offset) => ({
              id: `22222222-2222-4222-8222-${String(offset + 1).padStart(12, "0")}`,
              name: `スクロール確認-${offset + 1}`,
              round_date: "2026-09-15",
              format: "outdoor",
              bow_type: "recurve",
              total: 300,
              distances: [{ distance: 70, is_marked: true, total: 300 }],
            })),
            has_more: false,
          },
        });
      },
    );
    await page.reload();
    await openFilter(page);
    await makeError(page);

    // 余白のクリックと一覧のスクロールでは編集を失わない。
    await page.getByRole("heading", { level: 1 }).click();
    // 幅によってラウンド名は表示されないため、最後の行を位置でなく並びの末尾で指す。
    await expect(page.getByRole("listitem")).toHaveCount(12);
    const last = page.getByRole("listitem").last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await expect(panel(page)).toBeVisible();
    await expect(score(page)).toHaveValue("-");
    await expect(
      page.getByTestId("history-filter-error-scoreInvalid"),
    ).toBeVisible();

    // スクロール後もフィルターの上に重なる要素がなく、押して閉じ、もう一度押して開ける。
    await expect
      .poll(() =>
        toggle(page).evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const top = document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          );
          return top !== null && element.contains(top);
        }),
      )
      .toBe(true);
    await toggle(page).click();
    await expect(panel(page)).toBeHidden();
    await toggle(page).click();
    await expect(panel(page)).toBeVisible();
  });
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 568, height: 240 },
]) {
  test(`条件を内部スクロールしても${viewport.width}×${viewport.height}の操作行と閉じるボタンを押せる`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openFilter(page);
    await page.getByTestId("history-unit-distance").click();
    await page
      .getByTestId("history-filter-distance-select")
      .scrollIntoViewIfNeeded();
    for (const button of [
      action(page, "apply"),
      action(page, "reset"),
      closeButton(page),
    ]) {
      await expect
        .poll(() =>
          button.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const top = document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            );
            return top !== null && element.contains(top);
          }),
        )
        .toBe(true);
    }
    await action(page, "reset").click();
    await expect(page.getByTestId("history-unit-round")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(panel(page)).toBeVisible();
    await closeButton(page).click();
    await expect(panel(page)).toBeHidden();
  });
}

for (const [start, end] of [
  [
    { width: 375, height: 667 },
    { width: 800, height: 360 },
  ],
  [
    { width: 800, height: 360 },
    { width: 375, height: 667 },
  ],
] as const) {
  test(`回転 ${start.width}→${end.width} で全種類の条件・途中の文字・エラーを保ち取得しない`, async ({
    page,
  }) => {
    await page.setViewportSize(start);
    await openFilter(page);
    for (const [id, name] of [
      ["history-sort-date-direction", t("historyDateDirection.asc")],
      ["history-sort-score-direction", t("historyScoreDirection.desc")],
      ["history-filter-format", t("formatOption.indoor")],
      ["history-filter-bow-type", t("bowTypeOption.compound")],
    ]) {
      await page.getByTestId(id).click();
      await page.getByRole("option", { name, exact: true }).click();
    }
    await page.getByTestId("history-filter-dateFrom").fill("2026-05-03");
    await page.getByTestId("history-filter-dateTo").fill("2026-05-01");
    await page.getByTestId("history-filter-distance-add").click();
    await page.getByTestId("history-distance-dialog-distance").fill("18");
    await page.getByTestId("history-distance-dialog-arrowsPerEnd").fill("3");
    await page.getByTestId("history-distance-dialog-confirm").click();
    await expect(
      page.getByTestId("history-distance-dialog-confirm"),
    ).toBeHidden();
    await page.getByTestId("history-unit-distance").click();
    await page.getByTestId("history-filter-distance-select").click();
    await page.getByTestId("history-distance-dialog-distance").fill("30");
    await page.getByTestId("history-distance-dialog-confirm").click();
    await expect(
      page.getByTestId("history-distance-dialog-confirm"),
    ).toBeHidden();
    await makeError(page);
    await expect(
      page.getByTestId("history-filter-error-dateOrder"),
    ).toBeVisible();
    const requests: string[] = [];
    page.on("request", (request) => {
      if (/\/rpc\/(rounds_list|distances_list)/.test(request.url()))
        requests.push(request.url());
    });

    // 向きを変えて同じ下書きの編集を続ける。
    await page.setViewportSize(end);
    await expect(panel(page)).toBeVisible();
    for (const [field, value] of [
      ["dateFrom", "2026-05-03"],
      ["dateTo", "2026-05-01"],
      ["scoreMin", "-"],
    ]) {
      await expect(page.getByTestId(`history-filter-${field}`)).toHaveValue(
        value,
      );
    }
    for (const [id, name] of [
      ["history-sort-date-direction", t("historyDateDirection.asc")],
      ["history-sort-score-direction", t("historyScoreDirection.desc")],
      ["history-filter-format", t("formatOption.indoor")],
      ["history-filter-bow-type", t("bowTypeOption.compound")],
    ])
      await expect(page.getByTestId(id)).toHaveText(name);
    await expect(page.getByTestId("history-filter-distance-row")).toContainText(
      "30m",
    );
    await expect(page.getByTestId("history-unit-distance")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(
      page.getByTestId("history-filter-error-dateOrder"),
    ).toBeVisible();
    await expect(
      page.getByTestId("history-filter-error-scoreInvalid"),
    ).toBeVisible();

    // 「ラウンド」へ切り替えると、距離単位の間は隠れていたラウンド構成が、下書きのまま出る。
    await page.getByTestId("history-unit-round").click();
    await expect(page.getByTestId("history-filter-distance-0")).toContainText(
      "18m",
    );
    expect(requests).toEqual([]);
  });
}

test("一覧メニューのEscはメニューだけを閉じてフィルターの下書きとエラーを保持する", async ({
  page,
}) => {
  await openFilter(page);
  await makeError(page);
  await page.getByTestId("round-menu-trigger").click();
  await expect(page.getByTestId("round-delete")).toBeVisible();

  // 一覧メニューを閉じてフィルターの編集へ戻る。
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("round-delete")).toBeHidden();
  await expect(panel(page)).toBeVisible();
  await expect(score(page)).toHaveValue("-");
  await expect(
    page.getByTestId("history-filter-error-scoreInvalid"),
  ).toBeVisible();
});

for (const unit of ["round", "distance"] as const) {
  test(`${unit}の距離を確定・削除した後は残る起点へフォーカスが戻り外側を適用しない`, async ({
    page,
  }) => {
    await openFilter(page);
    if (unit === "distance")
      await page.getByTestId("history-unit-distance").click();
    const trigger = page.getByTestId(
      unit === "round"
        ? "history-filter-distance-add"
        : "history-filter-distance-select",
    );
    await trigger.click();
    await page.getByTestId("history-distance-dialog-distance").fill("50");
    await page.getByTestId("history-distance-dialog-confirm").click();
    await expect(
      page.getByTestId("history-distance-dialog-confirm"),
    ).toBeHidden();
    const summary = page.getByTestId(
      unit === "round"
        ? "history-filter-distance-0"
        : "history-filter-distance-row",
    );
    await expect(summary).toBeVisible();
    await expect(unit === "round" ? trigger : summary).toBeFocused();

    // 確定済みの距離を削除して残る追加・選択の操作へ戻る。
    await summary.click();
    await page.getByTestId("history-distance-dialog-delete").click();
    await expect(
      page.getByTestId("history-distance-dialog-confirm"),
    ).toBeHidden();
    await expect(summary).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(panel(page)).toBeVisible();
    await expect(page.getByTestId("history-controls-active")).toHaveCount(0);
  });
}

test("パネルを開いたまま一覧のカードから詳細へ移り、戻ると未適用の編集を持ち越さず閉じている", async ({
  page,
}) => {
  await openFilter(page);
  await makeError(page);
  await page.getByRole("link", { name: /ブラウザ結合の完了ラウンド/ }).click();
  await expect(page).toHaveURL(
    /\/rounds\/22222222-2222-4222-8222-222222222222/,
  );
  await expect(toggle(page)).toHaveCount(0);

  // 履歴へ戻ると、パネルは閉じ、未適用の値とエラーは残らない。
  await page.goBack();
  await expect(page).toHaveURL(/\/rounds\/history/);
  await expect(toggle(page)).toBeVisible();
  await expect(panel(page)).toBeHidden();
  await openFilter(page);
  await expect(score(page)).toHaveValue("");
  await expect(
    page.getByTestId("history-filter-error-scoreInvalid"),
  ).toHaveCount(0);
});

for (const state of ["failure", "empty", "offline"] as const) {
  test(`取得が${state}でも条件を編集して検索・リセット・フィルターの閉じる操作へ到達できる`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize(PORTRAIT);
    if (state === "failure")
      await page.route("**/rest/v1/rpc/rounds_list", (route) =>
        route.fulfill({ status: 500, json: { message: "boom" } }),
      );
    if (state === "empty")
      await page.route("**/rest/v1/rpc/rounds_list", (route) =>
        route.fulfill({ json: { rounds: [], has_more: false } }),
      );
    await page.reload();
    await expect(toggle(page)).toBeVisible();
    if (state === "failure")
      await expect(
        page.getByRole("button", { name: t("fetchRetry") }),
      ).toBeVisible();
    if (state === "empty")
      await expect(page.getByText(t("historyEmpty"))).toBeVisible();
    if (state === "offline") {
      // 通信を切って条件を適用し、取得に失敗した状態にする。
      await context.setOffline(true);
      await openFilter(page);
      await score(page).fill("100");
      await action(page, "apply").click();
      await expect(page.getByText(t("fetchOffline"))).toBeVisible();
    }

    // 一覧が各状態のままでも、条件の編集と操作行が使える。
    await openFilter(page);
    await score(page).fill("25");
    await expect(score(page)).toHaveValue("25");
    await action(page, "reset").click();
    await expect(score(page)).toHaveValue("");
    await action(page, "apply").focus();
    await expect(action(page, "apply")).toBeFocused();
    await toggle(page).click();
    await expect(panel(page)).toBeHidden();
  });
}
