import type { AccountSummary } from "../domain/account-summary";

// 端末のアカウントの概要の記録。サインインの通知で書き(`LocalIdentity`)、行の部品が読み直して更新する。保存先が使えない環境は想定しない。
// read: 記録の利用者が端末の識別情報の利用者と違うとき、または記録が無いときはnull。
// subscribe: 記録の変更を受ける(この文書の中の書き込みと消去)。解除する関数を返す。
export type AccountSummaryStore = {
  read(): AccountSummary | null;
  write(summary: AccountSummary): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
};
