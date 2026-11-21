import { randomUUID } from "node:crypto";
import { type Page, test } from "@playwright/test";
import { prepareConfirmedUserSession, signUpAndSignIn } from "./auth";
import { updateRound } from "./other-device";
import { createRoundWithClient, signInAsTestUser } from "./rounds";

export type Credentials = { email: string; password: string };

// ラウンドの有無で表示が変わるテスト用に、使い捨てのユーザーを作ってサインインする。
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

// 画面を移らず、ケース固有の利用者を新しいcontextへ用意する。
export async function createPreparedUser(
  page: Page,
  prefix = "e2e-rounds",
): Promise<Credentials> {
  const appUrl = test.info().project.use.baseURL;
  if (!appUrl) throw new Error("Missing application URL in e2e helper.");
  const credentials = {
    email: `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`,
    password: `password-${prefix}`,
  };
  await test.step("利用者のセッションを準備する", () =>
    prepareConfirmedUserSession(page.context(), appUrl, credentials));
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
    // マスの番号は、同じ距離・エンドの中で書いた順に1から振る。
    shots?: {
      scoreStr: string;
      scoreInt: number;
      distanceIndex?: number;
      endNumber?: number;
    }[];
  } = {},
): Promise<string> {
  return createRoundFixture(credentials, (fixture) =>
    fixture.addRound(name, roundDate, options),
  );
}

// 準備の認証と資源の寿命をケース内へ閉じる。他端末のセッションを失効させるsignOutは使わない。
export async function createRoundFixture<T>(
  credentials: Credentials,
  prepare: (fixture: {
    addRound: (
      name: string,
      roundDate: string,
      options?: NonNullable<Parameters<typeof addRound>[3]>,
    ) => Promise<string>;
  }) => Promise<T>,
): Promise<T> {
  return test.step("ラウンドのデータを準備する", async () => {
    const { supabase } = await signInAsTestUser(
      credentials.email,
      credentials.password,
    );
    try {
      return await prepare({
        async addRound(name, roundDate, options = {}) {
          const roundId = await createRoundWithClient(supabase, {
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
            shots: numberShots(options.shots),
          });
          if (options.completed)
            await updateRound(supabase, roundId, { status: "completed" });
          return roundId;
        },
      });
    } finally {
      await supabase.auth.stopAutoRefresh();
    }
  });
}

function numberShots(
  shots: NonNullable<Parameters<typeof addRound>[3]>["shots"],
) {
  const counts = new Map<string, number>();
  return shots?.map((shot) => {
    const cell = { distanceIndex: 0, endNumber: 1, ...shot };
    const key = `${cell.distanceIndex}-${cell.endNumber}`;
    const shotNumber = (counts.get(key) ?? 0) + 1;
    counts.set(key, shotNumber);
    return { ...cell, shotNumber };
  });
}
