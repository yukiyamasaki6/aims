import type { BrowserContext, Page } from "@playwright/test";

// セッションの更新の重なりを、決まった順序で起こすためのヘルパー。
// ブラウザがセッションを更新している通信の間に、別の書き手(proxy.tsのサーバー側の更新)が保存先のCookieを書き換えると、
// auth-jsは自分の更新結果を捨て、保存先には別の書き手の有効なセッションが残る。

const AUTH_COOKIE = "sb-localhost-auth-token";
const TOKEN_API = "**/auth/v1/token*";
// 別の書き手として重ねる要求だけを、Cookieを差し替える対象から外す印。
const OVERLAP_MARK = "e2e-session-overlap";

// 端末に保存されたセッションのexpires_atだけを過去にし、次のセッションの読み取りで、ブラウザが更新を始める状態にする。
// 重ねる時より前にproxy.tsがサーバー側で更新してCookieを新しくすると、ブラウザが更新しなくなる。
// そのため、proxy.tsへの要求では期限を書き換える前のCookieを送ってサーバー側で更新させず、応答のSet-Cookieも除く。
async function expireStoredSession(context: BrowserContext) {
  const cookies = (await context.cookies()).filter(
    (c) => c.name === AUTH_COOKIE,
  );
  // 分割されたCookie(`.0`、`.1`…)は扱わない。テストのユーザーのセッションは分割の長さに収まる。
  if (cookies.length !== 1) throw new Error("no single stored session");
  const [stored] = cookies;
  const session = JSON.parse(
    Buffer.from(stored.value.replace(/^base64-/, ""), "base64url").toString(
      "utf8",
    ),
  );
  session.expires_at = Math.floor(Date.now() / 1000) - 10;
  const expired = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  await context.addCookies([{ ...stored, value: expired }]);

  // Service Workerを通る要求も対象にするため、contextで扱う。
  // route.continueではCookieの差し替えが効かず、route.fetchは応答のSet-Cookieを保存先へ書くため、Nodeから送って応答を返す。
  await context.route(
    (url) =>
      /^\/(rounds|signin|signup|reset-password)(\/|$)/.test(url.pathname) &&
      !url.searchParams.has(OVERLAP_MARK),
    async (route) => {
      const request = route.request();
      const headers = await request.allHeaders();
      if (headers.cookie) {
        headers.cookie = headers.cookie.replace(
          `${AUTH_COOKIE}=${expired}`,
          `${AUTH_COOKIE}=${stored.value}`,
        );
      }
      const body = request.postDataBuffer();
      const response = await fetch(request.url(), {
        method: request.method(),
        headers,
        body: body ? new Uint8Array(body) : undefined,
        redirect: "manual",
      });
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        // 本文はfetchが展開済みのため、符号化と長さの見出しも除く。
        if (
          !["set-cookie", "content-encoding", "content-length"].includes(name)
        ) {
          responseHeaders[name] = value;
        }
      });
      // テストが終わった後に届いた応答は返せないため、その失敗は無視する。
      await route
        .fulfill({
          status: response.status,
          headers: responseHeaders,
          body: Buffer.from(await response.arrayBuffer()),
        })
        .catch(() => {});
    },
  );
}

// 別の書き手としてproxy.tsにサーバー側でセッションを更新させ、Set-Cookieで保存先を書き換えさせる。
async function writeFromServer(page: Page) {
  await page.evaluate(async (mark) => {
    await fetch(`/rounds?${mark}=1`, { headers: { RSC: "1" } });
  }, OVERLAP_MARK);
}

// セッションの期限を来させ、ブラウザの次のセッションの更新の通信を止める。
// requestedは更新が始まったときに解決する。releaseは、別の書き手に保存先を書き換えさせてから止めていた更新を通し、passedはそれを通したときに解決する。
export async function holdNextRefresh(page: Page) {
  const requested = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const passed = Promise.withResolvers<void>();
  let held = false;
  // Supabaseへの通信はService Workerを通るため、contextで扱う。
  await page.context().route(TOKEN_API, async (route) => {
    if (held) {
      await route.continue();
      return;
    }
    held = true;
    requested.resolve();
    await released.promise;
    await writeFromServer(page);
    await route.continue();
    passed.resolve();
  });
  // 期限を来させた直後の更新も止めるため、止める準備の後に期限を来させる。
  await expireStoredSession(page.context());
  return {
    requested: requested.promise,
    release: () => released.resolve(),
    passed: passed.promise,
  };
}

// セッションの期限を来させ、ブラウザの次のセッションの更新を、すぐに別の書き手の更新と重ねる。overlappedは、重ねた更新を通したときに解決する。
export async function overlapNextRefresh(page: Page) {
  const { requested, release, passed } = await holdNextRefresh(page);
  void requested.then(release);
  return { overlapped: passed };
}
