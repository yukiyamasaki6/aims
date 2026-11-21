import type { AccountSummaryStore } from "../application/account-summary-store";
import type { IdentityReader } from "../application/identity-reader";
import type { AccountSummary } from "../domain/account-summary";

const STORAGE_KEY = "aims:account-summary";

// 記録の変更を受ける購読者。この文書の中の全ての実装(入口ごとに作る)で共有する。
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

// 端末に、アカウントの概要を記録する(`localStorage`)。
// アクセストークンが切れたオフラインでは、セッションから概要(メールアドレス、Googleの手段)を読めないため、サインインの通知で書いた記録から表示する。
// 読み出しは、記録の利用者が端末の識別情報の利用者と違うとき、記録が無いとき、読めない形のときにnullを返す。
export function createBrowserAccountSummaryStore(
  identity: IdentityReader,
): AccountSummaryStore {
  return {
    read: () => {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === null) return null;
      const summary = parse(raw);
      return summary !== null && summary.userId === identity.read()
        ? summary
        : null;
    },
    write: (summary) => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(summary));
      notify();
    },
    clear: () => {
      window.localStorage.removeItem(STORAGE_KEY);
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function parse(raw: string): AccountSummary | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { userId, email, google } = value as Record<string, unknown>;
    if (typeof userId !== "string") return null;
    return {
      userId,
      email: typeof email === "string" ? email : null,
      google: parseGoogle(google),
    };
  } catch {
    return null;
  }
}

function parseGoogle(value: unknown): AccountSummary["google"] {
  if (typeof value !== "object" || value === null) return null;
  const { id, email } = value as Record<string, unknown>;
  return typeof id === "string"
    ? { id, email: typeof email === "string" ? email : null }
    : null;
}
