import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import {
  type SeedTargetFaceKey,
  seedTargetFace,
  withReversedArrays,
} from "../domain/target-face-test-helpers";
import { useTargetFaceLabel } from "./use-target-face-label";

// 公式の的19件の説明の文言そのもの。
const DESCRIPTIONS: [SeedTargetFaceKey, string][] = [
  [
    "A1",
    "アウトドア、122cm、リカーブ・コンパウンド・ベアボウ、1〜10点、Xあり、10点半径6.1cm、単一",
  ],
  [
    "A2",
    "アウトドア、80cm、リカーブ・コンパウンド・ベアボウ、1〜10点、Xあり、10点半径4cm、単一",
  ],
  [
    "A3",
    "アウトドア、80cm、リカーブ・コンパウンド・ベアボウ、5〜10点、Xあり、10点半径4cm、単一",
  ],
  ["A4", "インドア、60cm、リカーブ・ベアボウ、1〜10点、10点半径3cm、単一"],
  [
    "A5",
    "インドア、60cm、リカーブ・ベアボウ、6〜10点、10点半径3cm、三角三つ目",
  ],
  ["A6", "インドア、60cm、リカーブ・ベアボウ、6〜10点、10点半径3cm、縦三つ目"],
  ["B1", "インドア、60cm、コンパウンド、1〜10点、10点半径1.5cm、単一"],
  ["B3", "インドア、60cm、コンパウンド、6〜10点、10点半径1.5cm、三角三つ目"],
  ["B4", "インドア、60cm、コンパウンド、6〜10点、10点半径1.5cm、縦三つ目"],
  ["A7", "インドア、40cm、リカーブ・ベアボウ、1〜10点、10点半径2cm、単一"],
  [
    "A8",
    "インドア、40cm、リカーブ・ベアボウ、6〜10点、10点半径2cm、三角三つ目",
  ],
  ["A9", "インドア、40cm、リカーブ・ベアボウ、6〜10点、10点半径2cm、縦三つ目"],
  ["B2", "インドア、40cm、コンパウンド、1〜10点、10点半径1cm、単一"],
  ["B5", "インドア、40cm、コンパウンド、6〜10点、10点半径1cm、三角三つ目"],
  ["B6", "インドア、40cm、コンパウンド、6〜10点、10点半径1cm、縦三つ目"],
  ["A10", "フィールド、80cm、リカーブ・コンパウンド・ベアボウ、1〜6点、単一"],
  ["A11", "フィールド、60cm、リカーブ・コンパウンド・ベアボウ、1〜6点、単一"],
  ["A12", "フィールド、40cm、リカーブ・コンパウンド・ベアボウ、1〜6点、単一"],
  [
    "A13",
    "フィールド、20cm、リカーブ・コンパウンド・ベアボウ、1〜6点、縦三つ目",
  ],
];

function renderDescribe() {
  return renderHook(() => useTargetFaceLabel(), { wrapper: IntlTestProvider })
    .result.current;
}

describe("useTargetFaceLabel", () => {
  it.each(DESCRIPTIONS)(
    "公式の的%sの説明の文言そのものは、種別、サイズ、対応弓種、点数帯と中心、配置を並べた文になる",
    (key, expected) => {
      // Given

      // When
      const face = seedTargetFace(key);
      const description = renderDescribe()(face);

      // Then
      expect(description).toBe(expected);
    },
  );

  it("公式の的19件の説明は、互いに異なる", () => {
    // Given

    // When
    const faces = DESCRIPTIONS.map(([key]) => seedTargetFace(key));
    const descriptions = faces.map(renderDescribe());

    // Then
    expect(new Set(descriptions).size).toBe(19);
  });

  it("弓種、スポット、リングの配列の順が逆でも、弓種を並べる順と説明の文言そのものは変わらない", () => {
    // Given

    // When
    const faces = DESCRIPTIONS.map(([key]) =>
      withReversedArrays(seedTargetFace(key)),
    );
    const descriptions = faces.map(renderDescribe());

    // Then
    expect(descriptions).toEqual(DESCRIPTIONS.map(([, expected]) => expected));
  });
});
