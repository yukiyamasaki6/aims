import type { DiagnosticsSetting } from "../application/diagnostics-setting";

// メモリ上の診断の設定。writeは購読者へ知らせ、解除した購読者へは知らせない。
export function createFakeDiagnosticsSetting(
  initial = false,
): DiagnosticsSetting {
  let enabled = initial;
  const listeners = new Set<() => void>();
  return {
    read: () => enabled,
    write: (next) => {
      enabled = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
