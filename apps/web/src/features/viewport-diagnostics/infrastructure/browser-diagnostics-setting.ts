import type { DiagnosticsSetting } from "../application/diagnostics-setting";

const STORAGE_KEY = "aims:viewport-diagnostics";
const ENABLED_VALUE = "1";

function loadStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === ENABLED_VALUE;
  } catch {
    return false;
  }
}

function saveStored(enabled: boolean): void {
  try {
    if (enabled) {
      window.localStorage.setItem(STORAGE_KEY, ENABLED_VALUE);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // 保存先を使えないときは、そのセッションだけ変数の値で動く。
  }
}

// 端末の保存先(`localStorage`)に、有効のときだけ値を持つ。利用者・サインアウトとは独立で、サーバーへは送らない。
// 値は初回に保存先から読んで変数に持ち、書き込みと別タブの変更(`storage`イベント)で更新して購読者へ知らせる。
// 保存先を使えないときは、そのセッションだけ有効にでき、保持されない。
export function createBrowserDiagnosticsSetting(): DiagnosticsSetting {
  let current: boolean | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    current = loadStored();
    notify();
  };
  return {
    read() {
      current ??= loadStored();
      return current;
    },
    write(enabled) {
      current = enabled;
      saveStored(enabled);
      notify();
    },
    subscribe(listener) {
      if (listeners.size === 0) window.addEventListener("storage", onStorage);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0)
          window.removeEventListener("storage", onStorage);
      };
    },
  };
}
