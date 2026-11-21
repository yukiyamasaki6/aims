import type { Page } from "@playwright/test";

// Googleでの認証のE2Eの補助。Googleの画面へは移らず、Googleのドメインへの要求を止め、取り消しの戻りを認証サービスの/callbackの直接の呼び出しで再現する。

export type GoogleAuthorization = {
  // 認証サービスが付けた、この認証の識別の値。戻りに同じ値を付ける。
  state: string;
  // Googleから認証サービスへ戻る先(認証サービスの/callback)。
  callbackUrl: string;
};

export type GoogleBlock = {
  // Googleのドメインへ要求が起きたら、その要求の`state`と戻り先を返す。
  authorization: () => Promise<GoogleAuthorization>;
  // Googleのドメインへ起きた要求のURL。
  requests: string[];
};

// Googleへの転送を止める(Googleの画面は開かない)。画面を開いたまま、押した後の`authorization`で`state`を読む。
export async function blockGoogle(page: Page): Promise<GoogleBlock> {
  const requests: string[] = [];
  let resolve: (value: GoogleAuthorization) => void = () => {};
  const authorization = new Promise<GoogleAuthorization>((done) => {
    resolve = done;
  });
  function capture(location: string) {
    const url = new URL(location);
    requests.push(url.href);
    const state = url.searchParams.get("state");
    const callbackUrl = url.searchParams.get("redirect_uri");
    if (state && callbackUrl) resolve({ state, callbackUrl });
  }
  // ブラウザの遷移の転送先(Googleへの転送)は、`page.route`で止められない。転送を起こす認証サービスの開始の要求で止め、転送先のURLを読む。
  await page.route(/\/auth\/v1\/authorize\?/, async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    const location = response.headers().location;
    if (!location?.startsWith("https://accounts.google.com/")) {
      await route.fulfill({ response });
      return;
    }
    capture(location);
    await route.fulfill({ status: 200, contentType: "text/html", body: "" });
  });
  // Googleの追加(`linkIdentity`)は、開始の応答のJSONでGoogleのURLを受け取り、ブラウザがそこへ直接移る(転送を経ない)。移る遷移を止める。
  await page.route(
    /^https:\/\/accounts\.google\.com\/o\/oauth2\//,
    async (route) => {
      if (route.request().isNavigationRequest()) {
        capture(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "",
        });
        return;
      }
      await route.continue();
    },
  );
  return { authorization: () => authorization, requests };
}

// Googleの画面で取り消した戻りを、認証サービスが実際に付ける形(`error=access_denied`と説明、`error_code`なし)で開く。
export async function returnCancelledFromGoogle(
  page: Page,
  { state, callbackUrl }: GoogleAuthorization,
): Promise<void> {
  const url = new URL(callbackUrl);
  url.searchParams.set("error", "access_denied");
  url.searchParams.set(
    "error_description",
    "The user denied access to the application",
  );
  url.searchParams.set("state", state);
  await page.goto(url.href);
}
