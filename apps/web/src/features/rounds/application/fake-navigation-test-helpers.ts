import { vi } from "vitest";
import type { Navigation } from "./navigation";

// 遷移の呼び出しを観測できる画面の遷移。
// log: 渡すと`go:<path>`、`replace:<path>`を追記する(保存との順序の検証に使う)。
// failure: 渡すと、遷移で投げる。onGo: goのときに挙動を足す。
export function createFakeNavigation(
  options: {
    log?: string[];
    failure?: Error;
    onGo?: (path: string) => void;
  } = {},
) {
  const go = vi.fn((path: string) => {
    options.log?.push(`go:${path}`);
    options.onGo?.(path);
    if (options.failure) throw options.failure;
  });
  const replace = vi.fn((path: string) => {
    options.log?.push(`replace:${path}`);
    if (options.failure) throw options.failure;
  });
  const navigation: Navigation = { go, replace };
  return { navigation, go, replace };
}
