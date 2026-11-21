import { vi } from "vitest";
import type { AccountSummary } from "../domain/account-summary";
import type { AccountSummaryStore } from "./account-summary-store";

// 概要を端末に保つ記録の偽物。実物と同じく、書き込みと消去は購読者へ知らせる。読み出しは、記録の利用者の照合を含まない。
export function createFakeAccountSummaryStore(
  initial: AccountSummary | null = null,
): AccountSummaryStore {
  let current = initial;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    read: vi.fn(() => current),
    write: vi.fn((summary: AccountSummary) => {
      current = summary;
      notify();
    }),
    clear: vi.fn(() => {
      current = null;
      notify();
    }),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  };
}
