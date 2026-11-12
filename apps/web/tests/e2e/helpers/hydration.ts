import type { Page } from "@playwright/test";

// ハイドレーション不一致(#418)などのページエラーを集める。本番ビルドで動くため、
// 枠のHTMLとクライアントの初回描画のずれはここで現れる。
export function collectHydrationErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (/hydrat|#418|Minified React error/i.test(message.text())) {
      errors.push(message.text());
    }
  });
  return errors;
}
