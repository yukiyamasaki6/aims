import { describe, expect, it } from "vitest";
import { newShotId, shotIdAfter } from "./shot-id";

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NOW = 0x0199_0000_0000;
const ZEROS = new Uint8Array(10);
const ONES = new Uint8Array(10).fill(0xff);

function timeOf(id: string): number {
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}

describe("shotIdAfter", () => {
  describe("形式", () => {
    it("乱数によらず、版7・変種10の小文字36文字のUUIDにする", () => {
      // Given: 全ビット0と全ビット1の乱数
      // When
      const ids = [ZEROS, ONES].map((random) => shotIdAfter([], NOW, random));

      // Then
      for (const id of ids) expect(id).toMatch(UUID_V7);
      expect(ids[0]).toBe("01990000-0000-7000-8000-000000000000");
      expect(ids[1]).toBe("01990000-0000-7fff-bfff-ffffffffffff");
    });
  });

  describe("先頭48ビット", () => {
    it("エンドに矢が無いときは時計の値にする", () => {
      // Given / When
      const id = shotIdAfter([], NOW, ZEROS);

      // Then
      expect(timeOf(id)).toBe(NOW);
    });

    it("既にある矢がどれも時計より前なら時計の値にする", () => {
      // Given: 時計の1ミリ秒前に作った矢
      const earlier = shotIdAfter([], NOW - 1, ONES);

      // When
      const id = shotIdAfter([earlier], NOW, ZEROS);

      // Then
      expect(timeOf(id)).toBe(NOW);
      expect(id > earlier).toBe(true);
    });

    it.each([
      [
        "時計より先の時刻のID(時計の遅れた端末から見た他端末の矢)",
        "01990000-0005-7fff-bfff-ffffffffffff",
      ],
      ["移行で付けたような無作為のID", "ffffffff-fff0-4fff-bfff-ffffffffffff"],
    ])("%sより、文字列の比較で大きくする", (_name, existing) => {
      // Given / When
      const id = shotIdAfter(
        ["01990000-0000-7000-8000-000000000000", existing],
        NOW,
        ZEROS,
      );

      // Then
      expect(timeOf(id)).toBe(timeOf(existing) + 1);
      expect(id > existing).toBe(true);
    });

    it("同じ時計の値で続けて作っても、直前のIDより大きくする", () => {
      // Given: 同じミリ秒に、大きい乱数で作った直前の矢
      const first = shotIdAfter([], NOW, ONES);

      // When: 小さい乱数で次の矢を作る
      const second = shotIdAfter([first], NOW, ZEROS);
      const third = shotIdAfter([first, second], NOW, ZEROS);

      // Then
      expect(second > first).toBe(true);
      expect(third > second).toBe(true);
    });

    it("UUIDの形でないIDは数えない", () => {
      // Given / When
      const id = shotIdAfter(["s-9", "ffffffff"], NOW, ZEROS);

      // Then
      expect(timeOf(id)).toBe(NOW);
    });

    it("最大+1が48ビットを超えるときは時計の値にし、最大の1つ前は+1にする", () => {
      // Given: 先頭48ビットが最大値のIDと、その1つ前のID
      const atMax = "ffffffff-ffff-4fff-bfff-ffffffffffff";
      const belowMax = "ffffffff-fffe-4fff-bfff-ffffffffffff";

      // When
      const afterMax = shotIdAfter([atMax], NOW, ZEROS);
      const afterBelowMax = shotIdAfter([belowMax], NOW, ZEROS);

      // Then
      expect(timeOf(afterMax)).toBe(NOW);
      expect(afterBelowMax.startsWith("ffffffff-ffff-7")).toBe(true);
    });
  });
});

describe("newShotId", () => {
  it("端末の時計と乱数で、既にある矢より大きい版7のUUIDを作る", () => {
    // Given: 先頭の大きい既存の矢
    const existing = "ffffffff-fff0-4fff-bfff-ffffffffffff";

    // When
    const id = newShotId([existing]);

    // Then
    expect(id).toMatch(UUID_V7);
    expect(id > existing).toBe(true);
  });
});
