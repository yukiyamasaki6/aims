import { expect, type Page } from "@playwright/test";

// エンドのマス(距離・エンド・マスの番号は1始まり)。
export function cell(
  page: Page,
  distance: number,
  end: number,
  shotNumber: number,
) {
  return page.getByTestId(`shot-cell-${distance}-${end}-${shotNumber}`);
}

// エンドの各マスの点数を、マスの番号順に確かめる。nullは空のマス。
export async function expectCells(
  page: Page,
  distance: number,
  end: number,
  scores: (string | null)[],
) {
  for (const [index, score] of scores.entries()) {
    const target = cell(page, distance, end, index + 1);
    if (score === null) {
      await expect(target).toHaveAttribute("data-empty", "true");
    } else {
      await expect(target).not.toHaveAttribute("data-empty", "true");
      await expect(target).toHaveText(score);
    }
  }
}

// 指しているマスは、そのマスだけである。
export async function expectPointedCell(
  page: Page,
  distance: number,
  end: number,
  shotNumber: number,
) {
  const pointed = page.locator('[data-ring="cell"]');
  await expect(pointed).toHaveCount(1);
  await expect(pointed).toHaveAttribute(
    "data-testid",
    `shot-cell-${distance}-${end}-${shotNumber}`,
  );
}
