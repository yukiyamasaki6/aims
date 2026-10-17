// @vitest-environment node
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const ICONS = [
  { file: "../../public/icons/icon-192.png", size: 192 },
  { file: "../../public/icons/icon-512.png", size: 512 },
  { file: "../../public/icons/icon-192-maskable.png", size: 192 },
  { file: "../../public/icons/icon-512-maskable.png", size: 512 },
] as const;

async function sizeOf(file: string) {
  const path = fileURLToPath(new URL(file, import.meta.url));
  const { width, height } = await sharp(path).metadata();
  return { width, height };
}

describe.each(ICONS)("インストール用アイコン $file", ({ file, size }) => {
  it("画像の寸法が、manifestとファイル名が示す大きさである", async () => {
    // Given

    // When
    const result = await sizeOf(file);

    // Then
    expect(result).toEqual({ width: size, height: size });
  });
});

describe("apple-icon.png", () => {
  it("画像の寸法が、iOSのホーム画面用の180pxである", async () => {
    // Given

    // When
    const result = await sizeOf("./apple-icon.png");

    // Then
    expect(result).toEqual({ width: 180, height: 180 });
  });
});
