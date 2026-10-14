import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("manifest", () => {
  it("アプリ名・起動URL・表示モード・テーマ色を返す", () => {
    // Given
    // When
    const result = manifest();

    // Then
    expect(result).toMatchObject({
      name: "AIMS",
      short_name: "AIMS",
      start_url: "/rounds",
      display: "standalone",
      background_color: "#FFFFFF",
      theme_color: "#FFFFFF",
    });
  });

  it("アプリの識別子・範囲・向き・言語・分類・起動の扱い・説明を返す", () => {
    // Given
    // When
    const result = manifest();

    // Then
    expect(result).toMatchObject({
      id: "/rounds",
      scope: "/",
      orientation: "any",
      lang: "ja",
      dir: "ltr",
      categories: ["sports"],
      launch_handler: { client_mode: "focus-existing" },
      description: "アーチェリー点数管理アプリ",
    });
  });

  it("通常用とマスカブル用のアイコンを192・384・512・1024pxで返す", () => {
    // Given
    // When
    const result = manifest();

    // Then
    expect(result.icons).toEqual(
      [192, 384, 512, 1024].flatMap((size) => [
        {
          src: `/icons/icon-${size}.png`,
          sizes: `${size}x${size}`,
          type: "image/png",
          purpose: "any",
        },
        {
          src: `/icons/icon-${size}-maskable.png`,
          sizes: `${size}x${size}`,
          type: "image/png",
          purpose: "maskable",
        },
      ]),
    );
  });

  it("screenshotsを持たない", () => {
    // Given
    // When
    const result = manifest();

    // Then
    expect(result).not.toHaveProperty("screenshots");
  });
});
