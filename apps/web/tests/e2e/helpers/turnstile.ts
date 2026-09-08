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
          window.__turnstileRenderCount = 0;
          window.turnstile = {
            render: function (container, options) {
              window.__turnstileRenderCount++;
              // window.__turnstileFailFromCallをテスト側がpage.addInitScript()で
              // 事前に設定しておくと、指定した呼び出し回数目以降のウィジェットだけ
              // callbackを発火させない（captcha未完了の状態を再現する）。それより
              // 前の呼び出し（例: メール入力ステップの1回目）は通常通り成功する。
              var shouldFail =
                window.__turnstileFailFromCall &&
                window.__turnstileRenderCount >= window.__turnstileFailFromCall;
              if (!shouldFail && options && typeof options.callback === "function") {
                setTimeout(function () { options.callback("${DUMMY_TOKEN}"); }, 0);
              }
              return "mock-widget-id-" + window.__turnstileRenderCount;
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
