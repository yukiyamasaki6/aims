import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { signUpAndSignIn } from "./auth";
import { openOtherDevice, updateRound } from "./other-device";
import { createRound } from "./rounds";

export type Credentials = { email: string; password: string };

// ラウンドの有無で表示が変わるテスト用に、使い捨てのユーザーでサインアップしてサインインする。
export async function signInFreshUser(
  page: Page,
  prefix = "e2e-rounds",
): Promise<Credentials> {
  const credentials = {
    email: `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`,
    password: `password-${prefix}`,
  };
  await signUpAndSignIn(page, credentials);
  return credentials;
}

// サーバーにラウンドを作る。completedなら、別の端末のようにサーバーで完了にする。
export async function addRound(
  credentials: Credentials,
  name: string,
  roundDate: string,
  options: {
    completed?: boolean;
    shots?: { scoreStr: string; scoreInt: number }[];
  } = {},
): Promise<string> {
  const roundId = await createRound({
    ...credentials,
    name,
    roundDate,
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
    shots: options.shots?.map((shot) => ({
      distanceIndex: 0,
      endNumber: 1,
      ...shot,
    })),
  });
  if (options.completed) {
    const { supabase } = await openOtherDevice(
      credentials.email,
      credentials.password,
    );
    await updateRound(supabase, roundId, { status: "completed" });
  }
  return roundId;
}
