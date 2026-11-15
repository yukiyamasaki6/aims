"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { DeleteAccount } from "../application/delete-account";

const DeleteAccountContext = createContext<DeleteAccount | null>(null);

// アカウント削除の画面へ、アプリで1つの手続き(入口が生成して渡す)を渡す。
export function DeleteAccountProvider({
  deleteAccount,
  children,
}: {
  deleteAccount: DeleteAccount;
  children: ReactNode;
}) {
  return (
    <DeleteAccountContext.Provider value={deleteAccount}>
      {children}
    </DeleteAccountContext.Provider>
  );
}

export function useDeleteAccount(): DeleteAccount {
  const deleteAccount = useContext(DeleteAccountContext);
  if (!deleteAccount) throw new Error("DeleteAccountProvider がありません。");
  return deleteAccount;
}
