// サインインの状態の確認。例外: 投げない。
export type SessionCheck = {
  read(): Promise<
    | { status: "authenticated"; userId: string }
    | { status: "unauthenticated" | "unknown" }
  >;
};
