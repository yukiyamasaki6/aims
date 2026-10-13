import { describe, expect, it } from "vitest";
import { revealDelta } from "./scroll-to-pointer";

describe("revealDelta", () => {
  const visible = { visibleTop: 100, visibleBottom: 500 };

  it("行が見える範囲に収まる場合は0を返す", () => {
    // Given: 見える範囲100〜500に収まる行
    // When: スクロール量を求める
    const delta = revealDelta({ cellTop: 200, cellBottom: 240, ...visible });

    // Then: 動かない
    expect(delta).toBe(0);
  });

  it("行が見える範囲の端にちょうど接する場合は0を返す", () => {
    // Given: 上端100と下端500にちょうど接する行
    // When: スクロール量を求める
    const delta = revealDelta({ cellTop: 100, cellBottom: 500, ...visible });

    // Then: 動かない
    expect(delta).toBe(0);
  });

  it("行が下に1はみ出す場合は、許容の範囲として動かさない", () => {
    // Given: 下端が501の行（サブピクセルの誤差の範囲）
    // When: スクロール量を求める
    const delta = revealDelta({ cellTop: 461, cellBottom: 501, ...visible });

    // Then: 動かない
    expect(delta).toBe(0);
  });

  it("行が下に2はみ出す場合は、はみ出した分だけ正の値を返す", () => {
    // Given: 下端が502の行
    // When: スクロール量を求める
    const delta = revealDelta({ cellTop: 462, cellBottom: 502, ...visible });

    // Then: 2だけ下へ
    expect(delta).toBe(2);
  });

  it("行が上に1はみ出す場合は、許容の範囲として動かさない", () => {
    // Given: 上端が99の行（サブピクセルの誤差の範囲）
    // When: スクロール量を求める
    const delta = revealDelta({ cellTop: 99, cellBottom: 139, ...visible });

    // Then: 動かない
    expect(delta).toBe(0);
  });

  it("行が上に2はみ出す場合は、はみ出した分だけ負の値を返す", () => {
    // Given: 上端が98の行
    // When: スクロール量を求める
    const delta = revealDelta({ cellTop: 98, cellBottom: 138, ...visible });

    // Then: 2だけ上へ
    expect(delta).toBe(-2);
  });

  it("行が上下の両方にはみ出す場合は、下に隠れる分を優先する", () => {
    // Given: 範囲より大きい行
    // When: スクロール量を求める
    const delta = revealDelta({ cellTop: 50, cellBottom: 550, ...visible });

    // Then: 下へ50
    expect(delta).toBe(50);
  });
});
