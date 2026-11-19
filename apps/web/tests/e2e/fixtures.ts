import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BrowserContext,
  test as base,
  chromium,
  devices,
  expect,
  type Page,
  type Request,
} from "@playwright/test";
import {
  prepareConfirmedUserSession,
  SHARED_AUTH_STATE_PATH,
  setIsolatedEmail,
} from "./helpers/auth";
import { trackInflight } from "./helpers/inflight";
import { mockTurnstile } from "./helpers/turnstile";

// ブラウザのプロファイル(Cookie・localStorage・IndexedDB・Service Worker)を保ったまま閉じて開き直せる、アプリの再起動の再現。
export type RestartableProfile = {
  open: () => Promise<{ context: BrowserContext; page: Page }>;
  // 開いているブラウザを閉じる。次の`open`が、同じプロファイルで開き直す。
  close: () => Promise<void>;
};

// モックを省くケースの前提を、通信へ介入せずに監視する。
function watchAuthentication(context: BrowserContext) {
  const unexpected: string[] = [];
  const onRequest = (request: Request) => {
    const url = new URL(request.url());
    if (url.hostname.endsWith("cloudflare.com"))
      unexpected.push("Cloudflare request");
    if (
      request.isNavigationRequest() &&
      /^\/(signin|signup)(\/|$)/.test(url.pathname)
    ) {
      unexpected.push(url.pathname);
    }
  };
  context.on("request", onRequest);
  return async () => {
    context.off("request", onRequest);
    expect(unexpected, "認証画面へ到達しないケースの前提").toEqual([]);
    for (const page of context.pages()) {
      await expect(page.getByPlaceholder("you@example.com")).toHaveCount(0);
    }
  };
}

// UI認証のケースは既定のモックを使い、不要なケースだけ明示的に省く。
export const test = base.extend<{
  profile: RestartableProfile;
  turnstile: boolean;
  caseUser: undefined;
}>({
  turnstile: [true, { option: true }],
  caseUser: [
    async ({ context, storageState, baseURL }, use) => {
      if (storageState !== SHARED_AUTH_STATE_PATH) {
        await use(undefined);
        return;
      }
      if (!baseURL) throw new Error("Missing application URL in e2e fixture.");
      const email = `case-${randomUUID()}@aims.test`;
      setIsolatedEmail(email);
      await context.clearCookies();
      const userId = await prepareConfirmedUserSession(context, baseURL, {
        email,
        password: "unused",
      });
      // 共有利用者の端末の記憶を、サインイン後の端末と同じくケースの利用者のものへ替える。
      // 記憶を空のままにすると、アプリが利用者の切り替えとして最初の画面を読み込み直し、直後の操作と競合する。
      await context.addInitScript(
        ({ origin, email, userId }) => {
          if (
            location.origin !== origin ||
            localStorage.getItem("aims:e2e-case") === email
          )
            return;
          localStorage.clear();
          localStorage.setItem("aims:e2e-case", email);
          localStorage.setItem("aims:local-user-id", userId);
        },
        { origin: new URL(baseURL).origin, email, userId },
      );
      await use(undefined);
    },
    { auto: true },
  ],
  page: async ({ page, turnstile }, use) => {
    if (turnstile) await mockTurnstile(page);
    const verify = turnstile ? undefined : watchAuthentication(page.context());
    trackInflight(page.context());
    try {
      await use(page);
    } finally {
      await verify?.();
    }
  },
  profile: async ({ baseURL, turnstile }, use) => {
    const directory = await mkdtemp(join(tmpdir(), "aims-e2e-profile-"));
    let current: BrowserContext | undefined;
    let verify: (() => Promise<void>) | undefined;
    const close = async () => {
      try {
        await verify?.();
      } finally {
        verify = undefined;
        await current?.close();
        current = undefined;
      }
    };
    try {
      await use({
        async open() {
          current = await chromium.launchPersistentContext(directory, {
            ...devices["Desktop Chrome"],
            // biome-ignore lint/style/useNamingConvention: Playwrightの設定の項目名
            baseURL,
          });
          trackInflight(current);
          verify = turnstile ? undefined : watchAuthentication(current);
          const page = current.pages()[0] ?? (await current.newPage());
          if (turnstile) await mockTurnstile(page);
          return { context: current, page };
        },
        close,
      });
    } finally {
      try {
        await close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
});

export const testWithoutTurnstile = test.extend({ turnstile: false });

export { expect };
