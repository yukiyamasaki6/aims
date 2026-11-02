import { vi } from "vitest";
import type { SignInReader } from "./sign-in-reader";

export type SignInReading = Awaited<ReturnType<SignInReader["read"]>>;
type ReadOptions = Parameters<SignInReader["read"]>[0];

// 読み取りの値か、その値を返す関数(待ち続ける、投げる、といった挙動を作る)。
export type FakeSignInReading =
  | SignInReading
  | ((options?: ReadOptions) => Promise<SignInReading>);

const AUTHENTICATED: SignInReading = {
  status: "authenticated",
  userId: "user-1",
};

// 呼ばれるたびに、渡した読み取りを順に返し、尽きたら最後を繰り返すサインインの読み手。
// 空なら、常に認証済み(user-1)。`read`は呼び出し引数を観測できる。
export function createFakeSignInReader(
  readings: readonly FakeSignInReading[] = [],
) {
  const sequence = readings.length > 0 ? readings : [AUTHENTICATED];
  let index = 0;
  const read = vi.fn(async (options?: ReadOptions) => {
    const next = sequence[Math.min(index, sequence.length - 1)];
    index += 1;
    return typeof next === "function" ? next(options) : next;
  });
  return { signIn: { read } satisfies SignInReader, read };
}
