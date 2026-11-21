import { vi } from "vitest";
import type { PageAddress } from "./page-address";

export type FakePageAddress = PageAddress & {
  // `rewrite`で置き換えられた最後のクエリ。置き換えが無いときは初期のクエリ。
  current(): string;
};

// 今のクエリを持ち、書き換えを保つ`PageAddress`の偽物。`search`は`rewrite`の結果を返す。
export function createFakePageAddress(search = ""): FakePageAddress {
  let current = search;
  return {
    search: vi.fn(() => current),
    rewrite: vi.fn((next: string) => {
      current = next;
    }),
    current: () => current,
  };
}
