import type { Page } from "@playwright/test";

// 常にパスするCloudflareの公式ダミーキー（NEXT_PUBLIC_TURNSTILE_SITE_KEY・
// TURNSTILE_SECRET_KEYとも1x0...AA系のテスト専用キーを使用）と組み合わせて
// 使う前提。challenges.cloudflare.comのスクリプト取得・ハンドシェイクという
// 外部ネットワーク通信そのものをこのテスト実行からゼロにするためのモック。
// window.turnstileを@marsidev/react-turnstileが期待する最小限のAPI
// （render/reset/remove/getResponse）でスタブ化し、render()呼び出し時に
// 即座にcallbackへダミートークンを渡す。Supabase側はダミーのシークレット
// キーによりトークンの値を問わず検証を常に成功させるため、実際の
// signInWithOtp等のサーバー側フローには影響しない。
const DUMMY_TOKEN = "mock-turnstile-token";

export async function mockTurnstile(page: Page): Promise<void> {
  await page.route("**/challenges.cloudflare.com/**", async (route) => {
    const url = route.request().url();

    if (url.includes("/turnstile/v0/api.js")) {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: `
          window.turnstile = {
            render: function (container, options) {
              if (options && typeof options.callback === "function") {
                setTimeout(function () { options.callback("${DUMMY_TOKEN}"); }, 0);
              }
              return "mock-widget-id";
            },
            reset: function () {},
            remove: function () {},
            execute: function () {},
            isExpired: function () { return false; },
            getResponse: function () { return "${DUMMY_TOKEN}"; },
          };
          if (typeof window.onloadTurnstileCallback === "function") {
            window.onloadTurnstileCallback();
          }
        `,
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
}
