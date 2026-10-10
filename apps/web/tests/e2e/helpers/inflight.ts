import type { BrowserContext, Frame, Page, Request } from "@playwright/test";

// proxy.tsの対象のパスへの要求のうち、応答がまだ届いていないものを、contextごとに記録する。
// proxy.tsは応答にSet-Cookieでセッションを付けるため、保存先のCookieを書き換えた後にその応答が届くと、書き換えを元に戻す。
export const PROXY_PATH = /^\/(rounds|signin|signup|reset-password)(\/|$)/;

// 記録から外れたとき(完了、失敗、文書の破棄)に解決する。
type Tracked = Map<
  Request,
  { frame: Frame | null; gone: Promise<void>; markGone: () => void }
>;

// Service Workerが出した要求は枠を持たず、`frame()`が例外を投げる。
function frameOf(request: Request): Frame | null {
  try {
    return request.frame();
  } catch {
    return null;
  }
}
const inflightByContext = new WeakMap<BrowserContext, Tracked>();

function isTracked(request: Request) {
  return PROXY_PATH.test(new URL(request.url()).pathname);
}

export function trackInflight(context: BrowserContext) {
  if (inflightByContext.has(context)) return;
  const inflight: Tracked = new Map();
  const forget = (request: Request) => {
    inflight.get(request)?.markGone();
    inflight.delete(request);
  };
  inflightByContext.set(context, inflight);
  // 画面を移ると、移る前の文書が出した要求は、完了も失敗も通知されずに破棄される。
  // 移る間際に出た要求のイベントは、ナビゲーションの要求より後に届くことがあるため、移りの確定の時点で、その枠の記録をすべて外す。
  // 移った後の文書の要求が先に外れても、`settleInflight`がその要求を待たないだけである。
  context.on("request", (request) => {
    if (!isTracked(request)) return;
    const { promise: gone, resolve: markGone } = Promise.withResolvers<void>();
    inflight.set(request, { frame: frameOf(request), gone, markGone });
  });
  context.on("requestfinished", forget);
  context.on("requestfailed", forget);
  const watch = (page: Page) => {
    page.on("framenavigated", (frame) => {
      for (const [request, { frame: owner }] of [...inflight]) {
        if (owner === frame && !request.isNavigationRequest()) forget(request);
      }
    });
  };
  for (const page of context.pages()) watch(page);
  context.on("page", watch);
}

// 呼んだ時点で記録にある要求が、すべて応答の見出しを受け取る(Set-Cookieが適用される)か、記録から外れるまで待つ。
export async function settleInflight(context: BrowserContext) {
  const pending = [...(inflightByContext.get(context) ?? [])];
  await Promise.all(
    pending.map(([request, { gone }]) =>
      Promise.race([request.response().catch(() => null), gone]),
    ),
  );
}
