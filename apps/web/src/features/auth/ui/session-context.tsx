"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { Session } from "../application/session";

const SessionContext = createContext<Session | null>(null);

// 認証が要る画面の集合へ、アプリで1つのセッションの手続きを渡す。
export function SessionProvider({
  session,
  children,
}: {
  session: Session;
  children: ReactNode;
}) {
  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("SessionProvider がありません。");
  return session;
}
