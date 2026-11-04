import { vi } from "vitest";
import type { SessionReader, SessionReading } from "./session";

type ReadOptions = Parameters<SessionReader["readSession"]>[0];

// 読み取りの値か、その値を返す関数(待ち続ける、投げる、といった挙動を作る)。
export type FakeSessionReading =
  | SessionReading
  | ((options?: ReadOptions) => Promise<SessionReading>);

const AUTHENTICATED: SessionReading = {
  status: "authenticated",
  userId: "user-1",
};

// 呼ばれるたびに、渡した読み取りを順に返し、尽きたら最後を繰り返すサインインの状態の読み手。
// 空なら、常に認証済み(user-1)。`readSession`は呼び出し引数を観測できる。
export function createFakeSessionReader(
  readings: readonly FakeSessionReading[] = [],
) {
  const sequence = readings.length > 0 ? readings : [AUTHENTICATED];
  let index = 0;
  const readSession = vi.fn(async (options?: ReadOptions) => {
    const next = sequence[Math.min(index, sequence.length - 1)];
    index += 1;
    return typeof next === "function" ? next(options) : next;
  });
  return {
    sessionReader: { readSession } satisfies SessionReader,
    readSession,
  };
}
