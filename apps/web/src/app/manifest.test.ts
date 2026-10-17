import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("manifest", () => {
  it("アプリ名・起動URL・表示モードを返す", () => {
    // Given
    // When
    const result = manifest();

    // Then
    expect(result).toMatchObject({
      name: "AIMS",
      short_name: "AIMS",
      start_url: "/rounds",
      display: "standalone",
    });
  });

  it("通常用とマスカブル用のアイコンを192pxと512pxで返す", () => {
    // Given
    // When
    const result = manifest();

    // Then
    expect(result.icons).toEqual([
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ]);
  });
});
