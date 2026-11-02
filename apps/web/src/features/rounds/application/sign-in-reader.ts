type SignInReading =
  | { status: "authenticated"; userId: string }
  | { status: "unauthenticated"; message: string }
  | { status: "unknown"; message: string };

// サインインの状態の読み取り。例外: 投げない。未認証と不明(確かめられない)の文言は約束の値で受ける。
export type SignInReader = {
  read(options?: { refresh?: boolean }): Promise<SignInReading>;
};
