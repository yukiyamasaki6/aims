import {
  type SignInStatus,
  type StartPaths,
  startDestination,
} from "../domain/start-destination";

// 開始の行き先を決めるために、認証の機能に頼むこと。
// 例外: readStatusは投げない(確かめられないときはunknownを返す)。
// 行き先の経路(サインアップのパスと、サインインの後の既定の行き先)は、StartPathsの形で持つ。
export type SignInCheck = StartPaths & {
  // 今のサインインの状態を読む。
  readStatus(): Promise<SignInStatus>;
};

// 開始の行き先。画面を開いたときに1回だけ決める。
export type Start = {
  // 判定中の行き先。
  readonly pendingHref: string;
  // サインインの状態を読み、行き先を決める。投げない。
  decideHref(): Promise<string>;
};

export function createStart({
  signInCheck,
}: {
  signInCheck: SignInCheck;
}): Start {
  return {
    pendingHref: startDestination(null, signInCheck),
    decideHref: async () =>
      startDestination(await signInCheck.readStatus(), signInCheck),
  };
}
