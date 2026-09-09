import type { Page } from "@playwright/test";

// 再送クールダウン（60秒）の実待機を避けるためのヘルパー。呼び出し前に
// page.clock.install()を（画面遷移より前に）済ませておく必要がある。
// runFor()は1回の呼び出しではsetTimeoutが自身を再スケジュールする連鎖の
// 次の1回分までしか進めないため、1秒ずつ呼び出すループが必要。
export async function fastForwardResendCooldown(page: Page): Promise<void> {
  // pauseAt()にDate.now()をそのまま渡すと、コマンドがブラウザへ届くまでの
  // わずかな遅延で「既に過ぎた時刻」扱いになりエラーになることがあるため、
  // 少し先の時刻を指定する。
  await page.clock.pauseAt(new Date(Date.now() + 1_000));
  for (let i = 0; i < 61; i++) {
    await page.clock.runFor(1_000);
  }
}
