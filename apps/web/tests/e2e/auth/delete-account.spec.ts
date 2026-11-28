import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  signInWithEmailOtp,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import {
  backdateOtpEvidence,
  createGoogleLinkedUser,
  resetOtpSendInterval,
} from "../helpers/auth-db";
import {
  addParticipant,
  beginAs,
  type DbSession,
  expectWaitingForLock,
  withDbSessions,
  withLocalDb,
} from "../helpers/local-db";
import { getOtpCodeFromMailpit, mailIds } from "../helpers/mailpit";
import { signInOnOtherDevice } from "../helpers/other-browser-device";
import { getDistanceIds } from "../helpers/other-device";
import {
  addRound,
  createPreparedUser,
  signInFreshUser,
} from "../helpers/round-fixtures";
import { createRound, signInAsTestUser } from "../helpers/rounds";
import { cell, expectCells } from "../helpers/score-cells";
import { settingsPanel } from "../helpers/settings";

const t = translatorFor("auth");
const settings = translatorFor("settings");
const rounds = translatorFor("rounds");
const navigation = translatorFor("navigation");
// supabase/config.tomlのjwt_expiry（3600秒）を越える時間。
const PAST_JWT_EXPIRY_MS = 3_600_000 + 60_000;
test.use({ storageState: { cookies: [], origins: [] } });

// 「アカウントを削除」を押し、別の送信ボタンを挟まずに届く新しいコードを確認して削除し、遷移元なしのサインインへ移ったことの確認で終わる。
async function deleteWithNewCode(page: Page, email: string) {
  // 実Authの送信間隔は、送信時刻の記録を戻して、直前のログインのコード送信から60秒が経過した状態にする。
  await resetOtpSendInterval(email);
  const previous = await mailIds(email);
  await page.getByRole("button", { name: t("deleteAccountSubmit") }).click();
  await expect(page.getByPlaceholder(t("otpCodePlaceholder"))).toBeVisible();
  // コードを確認するまでは削除されず、設定パネルに留まる。
  await expect(page).toHaveURL(/#settings\/account\/delete-account$/);
  await page
    .getByPlaceholder(t("otpCodePlaceholder"))
    .fill(await getOtpCodeFromMailpit(email, previous));
  await page.getByRole("button", { name: t("deleteAccountVerify") }).click();
  await expect(page).toHaveURL(/\/signin$/);
}
test("OTPでログインした直後の利用者が設定から削除を選ぶと送信間隔の案内で留まり、間隔の後に押し直して現在メールへ届く新しいコードを確認すると削除されてサインインへ移り、再登録しても旧記録を表示しない", async ({
  page,
}) => {
  // 実物のチェックは、送信のたびのやり直しで新しい結果を渡す。モックにも同じ取り直しをさせる。
  await page.addInitScript(() => {
    Object.assign(window, { e2eTurnstileReissueOnReset: true });
  });
  // 記録のある利用者で削除画面へ進む。
  const credentials = await signInFreshUser(page, "delete-otp");
  const name = `削除前-${randomUUID()}`;
  await addRound(credentials, name, "2026-08-24", { completed: true });
  await page.goto("/rounds/history");
  await expect(page.getByText(name)).toBeVisible();
  await page
    .getByRole("link", { name: navigation("leftPanelSettings"), exact: true })
    .click();
  await settingsPanel(page)
    .getByRole("link", { name: settings("deleteAccountAction"), exact: true })
    .click();
  await expect(
    settingsPanel(page).getByRole("heading", { name: t("deleteAccountTitle") }),
  ).toBeVisible();
  await expect(
    settingsPanel(page).locator('[data-hydrated="true"]'),
  ).toBeAttached();

  // ログインの直後に削除を押すと、実Authの送信間隔でコードの送付が拒否され、削除されずに同じ画面へ理由が表示される。
  await page.getByRole("button", { name: t("deleteAccountSubmit") }).click();
  await expect(page.getByText(t("failure.rate_limited"))).toBeVisible();
  await expect(
    page.getByRole("button", { name: t("deleteAccountSubmit") }),
  ).toBeVisible();

  await deleteWithNewCode(page, credentials.email);

  // 同じメールで再登録し履歴に旧記録がないことを確認する。
  await signUpAndSignIn(page, credentials);
  await page.goto("/rounds/history");
  await expect(page.getByText(rounds("historyEmpty"))).toBeVisible();
  await expect(page.getByText(name)).toHaveCount(0);
});

test("Googleで作ったアカウントは、メールのコードの流れで削除でき、削除後は同じアドレスでサインインしても新しいアカウントになる", async ({
  page,
}) => {
  // 実物のチェックは、送信のたびのやり直しで新しい結果を渡す。モックにも同じ取り直しをさせる。
  await page.addInitScript(() => {
    Object.assign(window, { e2eTurnstileReissueOnReset: true });
  });
  // Googleで作ったアカウントに記録を置き、メールのコードでサインインして削除画面へ進む。
  const user = await createGoogleLinkedUser({
    email: `delete-google-${randomUUID()}@aims.test`,
    emailIdentity: false,
  });
  const credentials = { email: user.email, password: "unused-password1" };
  await signUpAndSignIn(page, credentials);
  const name = `削除前-${randomUUID()}`;
  await addRound(credentials, name, "2026-08-24", { completed: true });
  await page.goto("/rounds/history");
  await expect(page.getByText(name)).toBeVisible();
  await page
    .getByRole("link", { name: navigation("leftPanelSettings"), exact: true })
    .click();
  await settingsPanel(page)
    .getByRole("link", { name: settings("deleteAccountAction"), exact: true })
    .click();
  await expect(
    settingsPanel(page).getByRole("heading", { name: t("deleteAccountTitle") }),
  ).toBeVisible();
  await expect(
    settingsPanel(page).locator('[data-hydrated="true"]'),
  ).toBeAttached();

  // 新しいコードを確認して削除し、サインインへ移る。
  await deleteWithNewCode(page, user.email);

  // 同じアドレスで再びサインインすると、旧記録の無い新しいアカウントになる。
  await signUpAndSignIn(page, credentials);
  await page.goto("/rounds/history");
  await expect(page.getByText(rounds("historyEmpty"))).toBeVisible();
  await expect(page.getByText(name)).toHaveCount(0);
});

test("実AuthのOTPで署名されたJWTは本人の削除を許し改ざんJWTと別人IDを拒否する", async () => {
  const email = `delete-api-${randomUUID()}@aims.test`;
  await createConfirmedUser({ email });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const verified = await signInWithEmailOtp(client, email);
    expect(verified.error === null && verified.data.session !== null).toBe(
      true,
    );
    const token = verified.data.session?.access_token ?? "";
    const userId = verified.data.user?.id ?? "";
    const rpc = async (accessToken: string, expected: string) =>
      fetch(`${url}/rest/v1/rpc/delete_account`, {
        method: "POST",
        headers: {
          apikey: key,
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ expected_user_id: expected }),
      });
    const parts = token.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    payload.sub = randomUUID();
    parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
    expect((await rpc(parts.join("."), userId)).status).toBe(401);
    const wrong = await rpc(token, randomUUID());
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).message).toBe("account_deletion_forbidden");
    expect((await client.auth.getUser()).data.user?.id).toBe(userId);
    expect((await rpc(token, userId)).status).toBe(204);
  } finally {
    await client.auth.stopAutoRefresh();
  }
});

test("古いOTPのJWTは更新しても新しいコードの送付だけでも削除できず、再確認した新しいセッションだけが削除できる", async () => {
  const email = `delete-stale-${randomUUID()}@aims.test`;
  await createConfirmedUser({ email });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const stale = createClient(url, key, options);
  const recent = createClient(url, key, options);
  const rpc = async (accessToken: string, expected: string) => {
    const response = await fetch(`${url}/rest/v1/rpc/delete_account`, {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expected_user_id: expected }),
    });
    return {
      status: response.status,
      message: response.ok ? null : (await response.json()).message,
    };
  };
  const otpRequired = { status: 403, message: "otp_confirmation_required" };
  try {
    const first = await signInWithEmailOtp(stale, email);
    const userId = first.data.user?.id ?? "";
    const firstToken = first.data.session?.access_token ?? "";
    expect(first.error === null && firstToken !== "").toBe(true);
    // サーバーの認可はテスト側の時計を使えないため、セッションのOTPの記録を2分戻してから更新し、60秒を超えて古い証跡のJWTを得る。
    // 実際に60秒が経過することは確かめない。
    await backdateOtpEvidence(email);
    const refreshed = await stale.auth.refreshSession();
    const refreshedToken = refreshed.data.session?.access_token ?? "";
    expect(refreshed.error === null && refreshedToken !== firstToken).toBe(
      true,
    );
    expect(await rpc(refreshedToken, userId)).toEqual(otpRequired);

    // 新しいコードは送付されただけでは、どのセッションの証跡も更新しない。
    await resetOtpSendInterval(email);
    const previous = await mailIds(email);
    const sent = await recent.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, captchaToken: "test-captcha-token" },
    });
    expect(sent.error === null).toBe(true);
    const token = await getOtpCodeFromMailpit(email, previous);
    expect(await rpc(refreshedToken, userId)).toEqual(otpRequired);

    // 再確認で得た新しいセッションだけが新しい証跡を持ち、古いJWTには引き継がれない。
    const second = await recent.auth.verifyOtp({ email, token, type: "email" });
    const secondToken = second.data.session?.access_token ?? "";
    expect(second.error === null && secondToken !== "").toBe(true);
    expect(await rpc(refreshedToken, userId)).toEqual(otpRequired);
    expect(await rpc(secondToken, userId)).toEqual({
      status: 204,
      message: null,
    });
  } finally {
    await Promise.all([
      stale.auth.stopAutoRefresh(),
      recent.auth.stopAutoRefresh(),
    ]);
  }
});

test("別の端末でもサインインしている利用者がこの端末で削除すると、別の端末はアクセストークンの期限後にセッションを更新できずサインイン画面へ移動する", async ({
  page,
  browser,
}) => {
  // 別の端末でサインインして一覧を開く。
  const credentials = {
    email: `delete-other-device-${randomUUID()}@aims.test`,
    password: "unused",
  };
  const other = await signInOnOtherDevice(browser, credentials);
  try {
    // この端末でサインインし、削除画面へ進む。
    await signUpAndSignIn(page, credentials);
    await page.goto("/rounds#settings/account/delete-account");
    await expect(
      settingsPanel(page).getByRole("heading", {
        name: t("deleteAccountTitle"),
      }),
    ).toBeVisible();
    await expect(
      settingsPanel(page).locator('[data-hydrated="true"]'),
    ).toBeAttached();

    await deleteWithNewCode(page, credentials.email);

    // 別の端末は期限後の更新を拒否され、サインイン画面へ移る。
    const refresh = other.page.waitForResponse(
      (response) =>
        response.url().includes("/auth/v1/token") &&
        response.url().includes("grant_type=refresh_token"),
    );
    await other.page.clock.fastForward(PAST_JWT_EXPIRY_MS);
    expect((await refresh).ok()).toBe(false);
    await expect(other.page).toHaveURL(/\/signin/);
  } finally {
    await other.context.close();
  }
});

// 本人の直近のOTPでサインインし、公開APIで本人のアカウントを削除する。
async function deleteAccountOf(email: string) {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    const { data } = await signInWithEmailOtp(client, email);
    const { error } = await client.rpc("delete_account", {
      expected_user_id: data.user?.id,
    });
    expect(error).toBeNull();
  } finally {
    await client.auth.stopAutoRefresh();
  }
}

test("2人の射つ人のラウンドの片方がアカウントを削除した後、残る射つ人は同じ点数と合計を表示でき、削除した人のマスを直すと射手1の矢、空のマスへの記録は自分の射手の矢として保存される", async ({
  page,
}) => {
  // 削除する利用者が作って記録したラウンドに、残る利用者を射手2の射つ人として加える。射つ人を加える操作は無いため、DBへ直接用意する。
  const remaining = await createPreparedUser(page, "delete-remaining");
  const deleted = {
    email: `delete-shooter-${randomUUID()}@aims.test`,
    password: "unused-password1",
  };
  await createConfirmedUser(deleted);
  const roundId = await createRound({
    ...deleted,
    name: "2人の射つ人",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
    shots: [
      {
        distanceIndex: 0,
        endNumber: 1,
        shotNumber: 1,
        scoreStr: "10",
        scoreInt: 10,
      },
      {
        distanceIndex: 0,
        endNumber: 1,
        shotNumber: 2,
        scoreStr: "9",
        scoreInt: 9,
      },
    ],
  });
  const { supabase, userId } = await signInAsTestUser(
    remaining.email,
    remaining.password,
  );
  await addParticipant({ roundId, userId, shooterNumber: 2 });
  await deleteAccountOf(deleted.email);

  // 残る利用者がラウンドを開くと、同じ点数と合計が表示される。
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
  await expectCells(page, 1, 1, ["10", "9", null]);
  await expect(page.getByTestId("end-subtotal-1-1")).toHaveText("19");

  // 削除した人のマスを直し、空のマスへ記録する。
  const [distanceId] = await getDistanceIds(supabase, roundId);
  const savedShots = async () => {
    const { data, error } = await supabase
      .from("shots")
      .select("shot_number, score_str, shooter_number")
      .eq("distance_id", distanceId)
      .order("shot_number");
    if (error) throw error;
    return data.map(
      (s) => `${s.shot_number}:${s.score_str}:${s.shooter_number}`,
    );
  };
  await cell(page, 1, 1, 1).click();
  await page.getByTestId("score-button-7").click();
  await expect.poll(savedShots).toEqual(["1:7:1", "2:9:1"]);
  await cell(page, 1, 1, 3).click();
  await page.getByTestId("score-button-8").click();
  await expect.poll(savedShots).toEqual(["1:7:1", "2:9:1", "3:8:2"]);

  // 再読み込みしても、同じ点数が表示される。
  await page.reload();
  await waitForHydration(page);
  await expectCells(page, 1, 1, ["7", "9", "8"]);
});

// ここから下は、複数の接続で削除と他の操作を競合させ、ロックによる直列化を確かめる。
// 削除は、認可と外部の記録を持たない内部関数purge_accountを直接呼ぶ。
const DELETED_USER_ID = "00000000-0000-4000-8000-000000000001";
const TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000001";

async function confirmedUserId(label: string): Promise<string> {
  const email = `${label}-${randomUUID()}@aims.test`;
  await createConfirmedUser({ email });
  const { rows } = await withLocalDb((client) =>
    client.query<{ id: string }>("select id from auth.users where email = $1", [
      email,
    ]),
  );
  return rows[0].id;
}

type SharedRound = { roundId: string; distanceId: string };

// 指定した接続から、射手の番号を指定して、エンド1のその番号のマスへ記録する。
function recordOn(
  session: DbSession,
  round: SharedRound,
  shooterNumber: number,
) {
  return session.client.query<{ result: { reason: string | null }[] }>(
    "select public.record_shots($1::jsonb) as result",
    [
      JSON.stringify([
        {
          shot_event_id: randomUUID(),
          distance_id: round.distanceId,
          end_number: 1,
          shot_number: shooterNumber,
          score_str: "9",
          score_int: 9,
          shooter_number: shooterNumber,
        },
      ]),
    ],
  );
}

// 1人目が作ったラウンドに、残りの射つ人(射手2から)と代理の人を加え、各射つ人が自分の射手の矢を記録する。
async function createSharedRound(
  owners: string[],
  editor?: string,
): Promise<SharedRound> {
  const round = { roundId: randomUUID(), distanceId: randomUUID() };
  await withDbSessions(1, async ([session]) => {
    await beginAs(session, owners[0]);
    await session.client.query(
      `select public.create_round($1, $2, '競合', '2026-08-24', 'outdoor', 'recurve', $3::jsonb)`,
      [
        randomUUID(),
        round.roundId,
        JSON.stringify([
          {
            distance_event_id: randomUUID(),
            id: round.distanceId,
            position_key: "a",
            distance: 18,
            is_marked: true,
            total_ends: 12,
            arrows_per_end: 3,
            target_face_id: TARGET_FACE_ID,
          },
        ]),
      ],
    );
    await session.client.query("commit");
  });
  for (const [index, userId] of owners.entries()) {
    if (index > 0) {
      await addParticipant({
        roundId: round.roundId,
        userId,
        shooterNumber: index + 1,
      });
    }
  }
  if (editor) await addParticipant({ roundId: round.roundId, userId: editor });
  for (const [index, userId] of owners.entries()) {
    await withDbSessions(1, async ([session]) => {
      await beginAs(session, userId);
      await recordOn(session, round, index + 1);
      await session.client.query("commit");
    });
  }
  return round;
}

async function beginPurge(session: DbSession, userId: string) {
  await session.client.query("begin");
  await session.client.query("select public.purge_account($1)", [userId]);
}

// 先の接続のトランザクションを開いたまま後の操作を呼び、ロックの待ちを確かめてから先を確定して、後の操作の結果を返して確定する。
async function commitAfterWaiting<T>(
  first: DbSession,
  second: DbSession,
  run: () => Promise<T>,
): Promise<T> {
  const waiting = run();
  // 待ちの確認が先に失敗しても、接続を閉じるときの失敗を未処理にしない。
  waiting.catch(() => undefined);
  await expectWaitingForLock(second);
  await first.client.query("commit");
  const result = await waiting;
  await second.client.query("commit");
  return result;
}

// 2接続から2人を同時に削除する。後の削除は、先の削除の確定を待つ。
async function purgeConcurrently(firstUser: string, secondUser: string) {
  await withDbSessions(2, async ([first, second]) => {
    await beginPurge(first, firstUser);
    await second.client.query("begin");
    await commitAfterWaiting(first, second, () =>
      second.client.query("select public.purge_account($1)", [secondUser]),
    );
  });
}

// ラウンドに残る記録の件数。
async function remainingRecords(roundId: string): Promise<number> {
  const { rows } = await withLocalDb((client) =>
    client.query<{ count: number }>(
      `select ((select count(*) from public.rounds where id = $1)
        + (select count(*) from public.round_users where round_id = $1)
        + (select count(*) from public.distances where round_id = $1)
        + (select count(*) from public.shots where round_id = $1)
        + (select count(*) from public.round_events where round_id = $1)
        + (select count(*) from public.distance_events where round_id = $1)
        + (select count(*) from public.shot_events where round_id = $1))::int as count`,
      [roundId],
    ),
  );
  return rows[0].count;
}

// 射手の行と、矢と矢の履歴の射手番号。
function shooterRecords(roundId: string) {
  return withLocalDb(async (client) => {
    const select = async (sql: string) =>
      (await client.query(sql, [roundId])).rows;
    return {
      shooters: await select(
        "select id, shooter_number, user_id, role from public.round_users where round_id = $1 order by shooter_number",
      ),
      shots: await select(
        "select shot_number, shooter_number from public.shots where round_id = $1 order by shot_number",
      ),
      events: await select(
        "select shot_number, shooter_number, author_id from public.shot_events where round_id = $1 order by shot_number",
      ),
    };
  });
}

test("2人の射つ人が同時にアカウントを削除しても、射つ人のいないラウンドは記録を残さず消える", async () => {
  const [a, b, editor] = await Promise.all(
    ["race-a", "race-b", "race-editor"].map(confirmedUserId),
  );
  const round = await createSharedRound([a, b], editor);
  expect(await remainingRecords(round.roundId)).toBeGreaterThan(0);

  await purgeConcurrently(a, b);

  expect(await remainingRecords(round.roundId)).toBe(0);
});

test("射つ人3人のうち2人が同時にアカウントを削除しても、2人の射手は番号を保って別々に残る", async () => {
  const [a, b, c] = await Promise.all(
    ["race-a", "race-b", "race-c"].map(confirmedUserId),
  );
  const round = await createSharedRound([a, b, c]);
  const before = await shooterRecords(round.roundId);

  await purgeConcurrently(a, b);

  const after = await shooterRecords(round.roundId);
  const unlinked = { user_id: null, role: null };
  expect(after.shooters).toEqual([
    { ...before.shooters[0], ...unlinked },
    { ...before.shooters[1], ...unlinked },
    before.shooters[2],
  ]);
  expect(after.shots).toEqual(before.shots);
  expect(after.events).toEqual([
    { ...before.events[0], author_id: DELETED_USER_ID },
    { ...before.events[1], author_id: DELETED_USER_ID },
    before.events[2],
  ]);
});

test("他の射つ人の削除と並行するラウンドの削除は、削除の確定を待ち、残った1人の射つ人の削除として成功する", async () => {
  const [a, b] = await Promise.all(["race-a", "race-b"].map(confirmedUserId));
  const round = await createSharedRound([a, b]);

  const result = await withDbSessions(2, async ([first, second]) => {
    await beginPurge(first, a);
    await beginAs(second, b);
    return commitAfterWaiting(first, second, () =>
      second.client.query<{ result: { applied: boolean } }>(
        "select public.disable_round($1, $2) as result",
        [randomUUID(), round.roundId],
      ),
    );
  });

  expect(result.rows[0].result.applied).toBe(true);
  const { rows } = await withLocalDb((client) =>
    client.query(
      "select disabled_at is not null as disabled from public.rounds where id = $1",
      [round.roundId],
    ),
  );
  expect(rows).toEqual([{ disabled: true }]);
});

test("唯一の射つ人の削除と並行する記録は、デッドロックせず削除の確定を待ってMISSINGになる", async () => {
  const [owner, editor] = await Promise.all(
    ["race-owner", "race-editor"].map(confirmedUserId),
  );
  const round = await createSharedRound([owner], editor);

  const result = await withDbSessions(2, async ([first, second]) => {
    await beginPurge(first, owner);
    await beginAs(second, editor);
    return commitAfterWaiting(first, second, () => recordOn(second, round, 1));
  });

  expect(result.rows[0].result.map((r) => r.reason)).toEqual(["MISSING"]);
  expect(await remainingRecords(round.roundId)).toBe(0);
});

test("記録の確定の前に唯一の射つ人を削除すると、削除は記録の確定を待ち、記録を残さず消す", async () => {
  const [owner, editor] = await Promise.all(
    ["race-owner", "race-editor"].map(confirmedUserId),
  );
  const round = await createSharedRound([owner], editor);

  const recorded = await withDbSessions(2, async ([first, second]) => {
    await beginAs(first, editor);
    const record = await recordOn(first, round, 1);
    await second.client.query("begin");
    await commitAfterWaiting(first, second, () =>
      second.client.query("select public.purge_account($1)", [owner]),
    );
    return record.rows[0].result.map((r) => r.reason);
  });

  expect(recorded).toEqual([null]);
  expect(await remainingRecords(round.roundId)).toBe(0);
});
