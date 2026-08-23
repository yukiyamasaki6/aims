import { expect, test } from "@playwright/test";

test("トップページが表示され、Supabaseからメモ一覧を取得できる", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Memos" })).toBeVisible();

  await expect(page.getByText("読み込み中...")).toBeHidden();

  await expect(
    page.getByText(/Missing Supabase environment variables|permission denied/),
  ).not.toBeVisible();
});
