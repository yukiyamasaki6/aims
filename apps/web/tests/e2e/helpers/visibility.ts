import { expect, type Locator } from "@playwright/test";

// 要素の中の5点(中心と、四隅からinset内側)のうち、最前面に要素自身か子孫が見えている点の数を返す。
// 画面の外の点はelementFromPointがnullを返し、見えていない点に数える。
async function frontmostPoints(
  locator: Locator,
  inset: number,
): Promise<number> {
  return locator.evaluate((el, inset) => {
    const r = el.getBoundingClientRect();
    const points = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + inset, r.top + inset],
      [r.right - inset, r.top + inset],
      [r.left + inset, r.bottom - inset],
      [r.right - inset, r.bottom - inset],
    ];
    return points.filter(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && el.contains(hit);
    }).length;
  }, inset);
}

// 他の要素に覆われず、画面内に見えている(5点すべてで最前面)ことを、動きが止まるまで待って確かめる。
// 角の丸い要素は、角が丸みの外に出るため、丸みの大きさに合わせてinsetを大きくする。
export async function expectUncovered(locator: Locator, inset = 2) {
  await expect.poll(() => frontmostPoints(locator, inset)).toBe(5);
}

// 少なくとも一部が他の要素に覆われているか、画面の外にある(最前面でない点がある)ことを確かめる。
export async function expectPartlyCovered(locator: Locator) {
  await expect.poll(() => frontmostPoints(locator, 2)).toBeLessThan(5);
}

// どの点でも見えていない(覆われているか、画面の外か、畳まれている)ことを確かめる。
export async function expectHidden(locator: Locator) {
  await expect.poll(() => frontmostPoints(locator, 2)).toBe(0);
}
