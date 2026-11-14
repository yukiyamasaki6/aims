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
// 種別を省くと屋外(各距離12エンド×3射)、indoorなら各距離10エンド×3射で作る。弓種を省くとリカーブ。
// distancesを省くと18mの1行で作る。指定すると、その行を射つ順のまま作る。
export async function addRound(
  credentials: Credentials,
  name: string,
  roundDate: string,
  options: {
    completed?: boolean;
    format?: "outdoor" | "indoor";
    bowType?: "recurve" | "compound" | "barebow";
    distances?: {
      distance: number;
      totalEnds: number;
      arrowsPerEnd: number;
      targetFaceId?: string;
    }[];
    // 矢は1本ずつ記録する。distanceIndexとendNumberを省くと、最初の距離の1エンドに置く。
    shots?: {
      scoreStr: string;
      scoreInt: number;
      distanceIndex?: number;
      endNumber?: number;
    }[];
  } = {},
): Promise<string> {
  const roundId = await createRound({
    ...credentials,
    name,
    roundDate,
    format: options.format,
    bowType: options.bowType,
    distances: options.distances ?? [
      {
        distance: 18,
        totalEnds: options.format === "indoor" ? 10 : 12,
        arrowsPerEnd: 3,
      },
    ],
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
