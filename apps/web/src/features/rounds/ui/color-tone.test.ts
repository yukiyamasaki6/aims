import { describe, expect, it } from "vitest";
import { contrastText, paleTone } from "./color-tone";

describe("contrastText", () => {
  it("輝度が高い色には、黒系の文字色を返す", () => {
    // Given

    // When
    const onWhite = contrastText("#FFFFFF");
    const onYellow = contrastText("#FFE600");

    // Then
    expect(onWhite).toBe("#231F20");
    expect(onYellow).toBe("#231F20");
  });

  it("輝度が低い色には、白の文字色を返す", () => {
    // Given

    // When
    const onBlack = contrastText("#000000");
    const onBlue = contrastText("#00508C");

    // Then
    expect(onBlack).toBe("#FFFFFF");
    expect(onBlue).toBe("#FFFFFF");
  });

  it("輝度のしきい値の前後で、文字色が切り替わる", () => {
    // Given
    // 輝度0.6の前後: #999999は0.6(しきい値ちょうど)、#9A9A9Aは0.604。

    // When
    const atThreshold = contrastText("#999999");
    const aboveThreshold = contrastText("#9A9A9A");

    // Then
    expect(atThreshold).toBe("#FFFFFF");
    expect(aboveThreshold).toBe("#231F20");
  });
});

describe("paleTone", () => {
  it("色相と彩度を保って明度を上げた背景色と、固定の黒系の文字色を返す", () => {
    // Given

    // When
    const red = paleTone("#F65058");
    const white = paleTone("#FFFFFF");

    // Then
    expect(red).toEqual({ bg: "#FDCED1", fg: "#231F20" });
    expect(white).toEqual({ bg: "#E6E6E6", fg: "#231F20" });
  });

  it("無彩色でも例外にならず、灰色の背景色を返す", () => {
    // Given

    // When
    const tone = paleTone("#808080");

    // Then
    expect(tone).toEqual({ bg: "#E6E6E6", fg: "#231F20" });
  });
});
