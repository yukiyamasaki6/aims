import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { CHANGE_EMAIL_HASH } from "@/routes";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  signInWithEmailOtp,
  signUpAndSignIn,
} from "../helpers/auth";
import { resetOtpSendInterval } from "../helpers/auth-db";
import { fastForwardResendCooldown } from "../helpers/clock";
import { getOtpCodeFromMailpit, mailIds } from "../helpers/mailpit";
import {
  expectStillSignedIn,
  signInOnOtherDevice,
} from "../helpers/other-browser-device";
import {
  expectAccountCategory,
  openSettingsAt,
  panelBackLink,
  settingsPanel,
} from "../helpers/settings";
import { waitForTurnstileToken } from "../helpers/turnstile";

const authText = translatorFor("auth");
const settingsText = translatorFor("settings");

const PASSWORD = "password-original1";

// メールアドレスを変えるため、共有の認証状態は使わず、使い捨てのユーザーでサインインして始める。
test.use({ storageState: { cookies: [], origins: [] } });

// メールの本文に宛先のアドレスが入り、コードの取り出しが最初の6桁の数字を取るため、アドレスに6桁以上の数字の並びを含めない。
function uniqueEmail(prefix: string) {
  const letters = randomUUID().replaceAll(/\d/g, (digit) =>
    "ghijklmnop".charAt(Number(digit)),
  );
  return `${prefix}-${letters}@aims.test`;
}

const previousMail = new Map<string, string[]>();

type Addresses = { current: string; next: string };

function codeInput(page: Page, field: "current" | "new", addresses: Addresses) {
  return page.getByLabel(
    field === "current"
      ? authText("changeEmailCurrentCodeLabel", { email: addresses.current })
      : authText("changeEmailNewCodeLabel", { email: addresses.next }),
  );
}

function newEmailInput(page: Page) {
  return page.getByPlaceholder(authText("changeEmailNewPlaceholder"));
}

function sendButton(page: Page) {
  return page.getByRole("button", { name: authText("otpSendCode") });
}

function verifyButton(page: Page) {
  return page.getByRole("button", { name: authText("otpVerify") });
}

async function openChangeEmail(page: Page) {
  await openSettingsAt(page, CHANGE_EMAIL_HASH);
}

async function sendNewEmail(page: Page, email: string) {
  await newEmailInput(page).fill(email);
  await sendButton(page).click();
}

// 新しいメールアドレスを送って、コード確認の画面へ進んだことまで確かめる。
async function requestChange(page: Page, addresses: Addresses) {
  previousMail.set(addresses.current, await mailIds(addresses.current));
  previousMail.set(addresses.next, await mailIds(addresses.next));
  await sendNewEmail(page, addresses.next);
  await expect(codeInput(page, "new", addresses)).toBeVisible();
}

async function enterCodes(
  page: Page,
  addresses: Addresses,
  codes: { current?: string; next?: string },
) {
  if (codes.current !== undefined) {
    await codeInput(page, "current", addresses).fill(codes.current);
  }
  if (codes.next !== undefined) {
    await codeInput(page, "new", addresses).fill(codes.next);
  }
  await verifyButton(page).click();
}

// 宛先に届いたコードを取り出す。
async function mailedCodes(addresses: Addresses) {
  return {
    current: await getOtpCodeFromMailpit(
      addresses.current,
      previousMail.get(addresses.current),
    ),
    next: await getOtpCodeFromMailpit(
      addresses.next,
      previousMail.get(addresses.next),
    ),
  };
}

// 届いた2つのコードを入れて確認し、完了の表示へ進んだことまで確かめる。
async function confirmBoth(page: Page, addresses: Addresses) {
  await enterCodes(page, addresses, await mailedCodes(addresses));
  await expect(page.getByRole("status")).toHaveText(
    authText("changeEmailDone"),
  );
}

test("新しいメールアドレスを送り、現在と新しいアドレスへ届く2つのコードを確認すると、完了が表示され、戻ると分類「アカウント」へ移動し、新しいアドレスが現在として表示され、新しいアドレスでだけサインインでき、この端末はサインインしたままである", async ({
  page,
}) => {
  // 新しいメールアドレスを送って、コード確認の画面へ進む。
  const addresses = {
    current: uniqueEmail("change-email"),
    next: uniqueEmail("change-email-next"),
  };
  await signUpAndSignIn(page, { email: addresses.current, password: PASSWORD });
  await openChangeEmail(page);
  await requestChange(page, addresses);

  // 届いた2つのコードを入れて確認し、完了の表示へ進む。
  await confirmBoth(page, addresses);
  await expect(
    page.getByRole("heading", { name: authText("changeEmailTitle") }),
  ).toBeVisible();
  await expect(newEmailInput(page)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${CHANGE_EMAIL_HASH}$`));

  // 戻るを押して、分類「アカウント」へ進む。
  await panelBackLink(page).click();
  await expectAccountCategory(page);

  // メールアドレス変更の項目を押し直すと、新しいアドレスが現在として表示される。
  await settingsPanel(page)
    .getByRole("link", { name: settingsText("changeEmailItem") })
    .click();
  await expect(
    page.getByText(authText("changeEmailCurrent", { email: addresses.next })),
  ).toBeVisible();

  // 別のクライアントでは新しいアドレスだけが使え、この端末はサインインしたままである。
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    const result = await signInWithEmailOtp(client, addresses.next);
    expect(result.error === null).toBe(true);
    expect(result.data.user?.email).toBe(addresses.next);
  } finally {
    await client.auth.stopAutoRefresh();
  }
  await page.goto("/rounds");
  await expect(page).toHaveURL(/\/rounds/);
});

test("一方のコードを誤って確認すると、誤りの欄にだけエラーが出て、誤りの欄だけ正しいコードに直して確認すると完了する", async ({
  page,
}) => {
  // 新しいメールアドレスを送って、コード確認の画面へ進む。
  const addresses = {
    current: uniqueEmail("change-email-partial"),
    next: uniqueEmail("change-email-partial-next"),
  };
  await signUpAndSignIn(page, { email: addresses.current, password: PASSWORD });
  await openChangeEmail(page);
  await requestChange(page, addresses);

  // 変更前の欄に誤りのコード、変更後の欄に正しいコードを入れて確認し、変更前の欄にだけエラーが出た状態へ進む。
  const codes = await mailedCodes(addresses);
  await enterCodes(page, addresses, {
    current: codes.current === "000000" ? "111111" : "000000",
    next: codes.next,
  });
  await expect(codeInput(page, "current", addresses)).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(codeInput(page, "new", addresses)).toHaveAttribute(
    "aria-invalid",
    "false",
  );

  // 変更前の欄だけ正しいコードに直して確認し、完了の表示へ進み、変更を完了する。
  await codeInput(page, "current", addresses).fill(codes.current);
  await verifyButton(page).click();
  await expect(page.getByRole("status")).toHaveText(
    authText("changeEmailDone"),
  );
});

test("コード確認で再送の待機を過ぎて再送すると、新しいコードが両方のアドレスへ届き、前のコードは使えず、新しいコードで変更できる", async ({
  page,
}) => {
  // 新しいメールアドレスを送って、コード確認の画面へ進み、最初のコードを控える。
  const addresses = {
    current: uniqueEmail("change-email-resend"),
    next: uniqueEmail("change-email-resend-next"),
  };
  await signUpAndSignIn(page, { email: addresses.current, password: PASSWORD });
  await page.clock.install();
  await openChangeEmail(page);
  await requestChange(page, addresses);
  const first = await mailedCodes(addresses);

  // 再送の待機時間を過ぎて再送し、両方のアドレスへ新しいコードが届く。
  const resendButton = page.getByRole("button", {
    name: new RegExp(`^${authText("otpResend")}`),
  });
  await waitForTurnstileToken(page, 1);
  await fastForwardResendCooldown(page);
  await expect(resendButton).toHaveText(authText("otpResend"));
  // ブラウザ時計の早送りはAuthの送信間隔を進めないため、送信時刻の記録を戻して実時間の経過の代わりにする。
  await resetOtpSendInterval(addresses.current);
  previousMail.set(addresses.current, await mailIds(addresses.current));
  previousMail.set(addresses.next, await mailIds(addresses.next));
  await resendButton.click();
  await expect(async () => {
    const latest = await mailedCodes(addresses);
    expect(latest.current !== first.current).toBe(true);
    expect(latest.next !== first.next).toBe(true);
  }).toPass();

  // コード欄が空になっていて、前のコードは使えず、両方の欄に誤りまたは期限切れの表示が出る。
  await expect(codeInput(page, "current", addresses)).toHaveValue("");
  await expect(codeInput(page, "new", addresses)).toHaveValue("");
  await enterCodes(page, addresses, {
    current: first.current,
    next: first.next,
  });
  await expect(codeInput(page, "current", addresses)).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(codeInput(page, "new", addresses)).toHaveAttribute(
    "aria-invalid",
    "true",
  );

  // 新しい2つのコードで確認して、完了の表示へ進む。
  await confirmBoth(page, addresses);
});

test("すでに別の利用者が使っているアドレスを入力すると、使えない旨が表示され、別のアドレスで進める", async ({
  page,
}) => {
  // 別の利用者のアドレスを送って、使えない旨の表示へ進む。
  const email = uniqueEmail("change-email-taken");
  const taken = uniqueEmail("change-email-taken-owner");
  await createConfirmedUser({ email: taken, password: PASSWORD });
  await signUpAndSignIn(page, { email, password: PASSWORD });
  await openChangeEmail(page);
  await sendNewEmail(page, taken);
  await expect(page.getByText(authText("failure.email_exists"))).toBeVisible();

  // 別のアドレスを送って、コード確認の画面へ進む。
  await requestChange(page, {
    current: email,
    next: uniqueEmail("change-email-taken-next"),
  });
});

test("現在と同じアドレスを入力すると、同じアドレスにはできない旨が表示され、コード確認へ進まない", async ({
  page,
}) => {
  const email = uniqueEmail("change-email-same");
  await signUpAndSignIn(page, { email, password: PASSWORD });
  await openChangeEmail(page);
  await sendNewEmail(page, email);
  await expect(page.getByText(authText("failure.same_email"))).toBeVisible();
  await expect(verifyButton(page)).not.toBeVisible();
});

test("別の端末でサインインしているとき、この端末が変更を完了しても、この端末と別の端末はサインインしたままである", async ({
  page,
  browser,
}) => {
  // 別の端末でサインインしておく。
  const addresses = {
    current: uniqueEmail("change-email-device"),
    next: uniqueEmail("change-email-device-next"),
  };
  const otherDevice = await signInOnOtherDevice(browser, {
    email: addresses.current,
    password: PASSWORD,
  });

  // この端末で新しいメールアドレスを送って、コード確認の画面へ進む。
  await signUpAndSignIn(page, { email: addresses.current, password: PASSWORD });
  await openChangeEmail(page);
  await requestChange(page, addresses);

  // 届いた2つのコードを入れて確認し、完了の表示へ進む。
  await confirmBoth(page, addresses);

  // この端末はサインインしたままで、別の端末は期限が切れた後の更新に成功する。
  await page.goto("/rounds");
  await expect(page).toHaveURL(/\/rounds/);
  await expectStillSignedIn(otherDevice.page);
  await otherDevice.context.close();
});
