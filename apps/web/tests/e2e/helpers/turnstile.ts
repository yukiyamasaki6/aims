import { expect, type Page } from "@playwright/test";

// 常にパスするCloudflareの公式ダミーキー（NEXT_PUBLIC_TURNSTILE_SITE_KEY・
// TURNSTILE_SECRET_KEYとも1x0...AA系のテスト専用キーを使用）と組み合わせて
// 使う前提。challenges.cloudflare.comのスクリプト取得・ハンドシェイクという
// 外部ネットワーク通信そのものをこのテスト実行からゼロにするためのモック。
// window.turnstileを@marsidev/react-turnstileが期待する最小限のAPI
// （render/reset/remove/getResponse）でスタブ化し、render()呼び出し時に
// 即座にcallbackへダミートークンを渡す。Supabase側はダミーのシークレット
// キーによりトークンの値を問わず検証を常に成功させるため、実際の
// signInWithOtp等のサーバー側フローには影響しない。
// interaction-onlyで操作が必要なチャレンジは、テスト側がpage.addInitScript()で
// window.e2eTurnstileInteractiveを真にすると再現できる。render()はcallbackを
// 呼ばずbefore-interactive-callbackだけを呼び、テスト側がwindow.e2eTurnstileSolve()
// を呼ぶとafter-interactive-callbackに続けてcallbackへトークンを渡す。
// ウィジェットの枠の代わりに、300x65の目印の要素(data-turnstile-widget)を
// コンテナへ挿入し、枠が利用者に見えているかをテストが確かめられるようにする。
// callbackを呼んだ回数をwindow.e2eTurnstileTokenCountに、reset()を呼んだ回数を
// window.e2eTurnstileResetCountに数える(どちらもページを読み込み直すと0に戻る)。
// window.e2eTurnstileReissueOnResetをテスト側がpage.addInitScript()で真にすると、
// reset()の後に最後に描いたウィジェットのcallbackへ新しいトークンを渡す(チェックの取り直しの再現)。
// テストは、waitForTurnstileTokenでトークンの受け取りを待ち、expectTurnstileResetで
// チェックのやり直しの依頼を確かめる。
const DUMMY_TOKEN = "mock-turnstile-token";

export async function mockTurnstile(page: Page): Promise<void> {
  await page.route("**/challenges.cloudflare.com/**", async (route) => {
    const url = route.request().url();

    if (url.includes("/turnstile/v0/api.js")) {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: `
          window.e2eTurnstileRenderCount = 0;
          window.e2eTurnstileTokenCount = 0;
          window.e2eTurnstileResetCount = 0;
          function emitToken(options) {
            window.e2eTurnstileTokenCount++;
            options.callback("${DUMMY_TOKEN}");
          }
          // 最後に描いたウィジェットのoptions。resetはoptionsを持たないため保持する。
          var lastOptions = null;
          window.turnstile = {
            render: function (container, options) {
              window.e2eTurnstileRenderCount++;
              lastOptions = options;
              var widget = document.createElement("div");
              widget.setAttribute("data-turnstile-widget", "");
              widget.style.width = "300px";
              widget.style.height = "65px";
              container.appendChild(widget);
              if (window.e2eTurnstileInteractive) {
                if (options && typeof options["before-interactive-callback"] === "function") {
                  options["before-interactive-callback"]();
                }
                window.e2eTurnstileSolve = function () {
                  if (typeof options["after-interactive-callback"] === "function") {
                    options["after-interactive-callback"]();
                  }
                  emitToken(options);
                };
                return "mock-widget-id-" + window.e2eTurnstileRenderCount;
              }
              // window.e2eTurnstileFailFromCallをテスト側がpage.addInitScript()で
              // 事前に設定しておくと、指定した呼び出し回数目以降のウィジェットだけ
              // callbackを発火させない（captcha未完了の状態を再現する）。それより
              // 前の呼び出し（例: メール入力ステップの1回目）は通常通り成功する。
              var shouldFail =
                window.e2eTurnstileFailFromCall &&
                window.e2eTurnstileRenderCount >= window.e2eTurnstileFailFromCall;
              if (!shouldFail && options && typeof options.callback === "function") {
                setTimeout(function () { emitToken(options); }, 0);
              }
              return "mock-widget-id-" + window.e2eTurnstileRenderCount;
            },
            // window.e2eTurnstileReissueOnResetを真にすると、resetの後に新しいトークンを
            // 非同期で渡す(画面がトークンを消した後に届く)。既定ではトークンを発行しない。
            reset: function () {
              window.e2eTurnstileResetCount++;
              if (
                window.e2eTurnstileReissueOnReset &&
                lastOptions &&
                typeof lastOptions.callback === "function"
              ) {
                var options = lastOptions;
                setTimeout(function () { emitToken(options); }, 0);
              }
            },
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

type TurnstileCounts = {
  e2eTurnstileTokenCount?: number;
  e2eTurnstileResetCount?: number;
};

// トークンを受け取った回数(ページを読み込んでからの累計)。
export async function turnstileTokenCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as TurnstileCounts).e2eTurnstileTokenCount ?? 0,
  );
}

// トークンを受け取った回数が`count`以上になるまで待ち、画面がそのトークンを反映する描画を終えるまで待つ。
// 回数はページを読み込んでからの累計で、同じ文書の中で画面が切り替わると、切り替えた先のウィジェットの分が加わる。
export async function waitForTurnstileToken(
  page: Page,
  count: number,
): Promise<void> {
  await page.waitForFunction(
    (expected) =>
      ((window as unknown as TurnstileCounts).e2eTurnstileTokenCount ?? 0) >=
      expected,
    count,
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

// チェックのやり直しの依頼(reset)が`count`回以上になったことを確かめる。
export async function expectTurnstileReset(
  page: Page,
  count: number,
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as TurnstileCounts).e2eTurnstileResetCount ?? 0,
      ),
    )
    .toBeGreaterThanOrEqual(count);
}
