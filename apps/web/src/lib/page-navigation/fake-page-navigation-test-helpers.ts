import { vi } from "vitest";
import type { PageNavigation } from "./contract/page-navigation";

// 遷移の呼び出しを観測できる画面の遷移。
// log: 渡すと`go:<path>`、`replace:<path>`を追記する(保存との順序の検証に使う)。
// onGo: goのときに挙動を足す。
export function createFakePageNavigation(
  options: { log?: string[]; onGo?: (path: string) => void } = {},
) {
  const go = vi.fn((path: string) => {
    options.log?.push(`go:${path}`);
    options.onGo?.(path);
  });
  const replace = vi.fn((path: string) => {
    options.log?.push(`replace:${path}`);
  });
  const pageNavigation: PageNavigation = { go, replace };
  return { pageNavigation, go, replace };
}
