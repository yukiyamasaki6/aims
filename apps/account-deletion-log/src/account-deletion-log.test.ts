import { describe, expect, it } from "vitest";
import { recordAccountDeletion } from "./account-deletion-log";
import { createMemoryBucket } from "./account-deletion-log-test-helpers";

const AUTH_KEY = "test-auth-key";
const USER_ID = "3f2b8c1e-5d4a-4e7b-9a60-1c2d3e4f5a6b";
const NOW = new Date("2026-11-21T12:34:56.000Z");

function post(
  body: BodyInit | null,
  authorization: string | null = `Bearer ${AUTH_KEY}`,
) {
  return new Request("https://worker.test/", {
    method: "POST",
    headers: {
      ...(authorization === null ? {} : { Authorization: authorization }),
      "Content-Type": "application/json",
    },
    body,
  });
}

function postUser(userId: unknown, authorization?: string | null) {
  return post(JSON.stringify({ user_id: userId }), authorization);
}

function dependencies(
  bucket = createMemoryBucket(),
  authKey: string | undefined = AUTH_KEY,
) {
  return { bucket, authKey, now: () => NOW };
}

describe("削除の記録を受け取る", () => {
  it("正しい鍵と利用者IDの要求は、利用者IDと時刻だけの記録をdeletions/<利用者ID>へ置いて、成功を返す", async () => {
    // Given
    const bucket = createMemoryBucket();

    // When
    const response = await recordAccountDeletion(
      postUser(USER_ID),
      dependencies(bucket),
    );

    // Then
    expect(response.status).toBe(201);
    expect([...bucket.objects.keys()]).toEqual([`deletions/${USER_ID}`]);
    expect(
      JSON.parse(bucket.objects.get(`deletions/${USER_ID}`) ?? ""),
    ).toEqual({
      user_id: USER_ID,
      recorded_at: "2026-11-21T12:34:56.000Z",
    });
  });

  it("同じ利用者IDの記録が既にあるときは、上書きせずに成功を返す", async () => {
    // Given
    const bucket = createMemoryBucket();
    bucket.objects.set(`deletions/${USER_ID}`, "first");

    // When
    const response = await recordAccountDeletion(
      postUser(USER_ID),
      dependencies(bucket),
    );

    // Then
    expect(response.status).toBe(200);
    expect(bucket.objects.get(`deletions/${USER_ID}`)).toBe("first");
  });

  it("書込みが失敗しても、同じ利用者の記録が先に置かれていれば成功を返す", async () => {
    // Given
    // 同時の記録で、確認の後にバケットロックが上書きを拒否した状況を、確認が1回目だけ「無い」を返す代役で再現する。
    const bucket = createMemoryBucket();
    let headCalls = 0;
    bucket.head = async (key) => {
      headCalls += 1;
      return headCalls === 1 ? null : { key };
    };
    bucket.failPut = true;

    // When
    const response = await recordAccountDeletion(
      postUser(USER_ID),
      dependencies(bucket),
    );

    // Then
    expect(response.status).toBe(200);
  });
});

describe("削除の記録を拒否する", () => {
  it.each([
    ["鍵が無い", null],
    ["鍵が誤り", "Bearer wrong-key"],
    ["鍵の長さが違う", `Bearer ${AUTH_KEY}x`],
    ["Bearerの形式でない", AUTH_KEY],
    ["Bearerの後が空", "Bearer "],
  ])("%s要求は、401で拒否し、何も置かない", async (_label, authorization) => {
    // Given
    const bucket = createMemoryBucket();

    // When
    const response = await recordAccountDeletion(
      postUser(USER_ID, authorization),
      dependencies(bucket),
    );

    // Then
    expect(response.status).toBe(401);
    expect(bucket.objects.size).toBe(0);
  });

  it.each([
    ["利用者IDが空", JSON.stringify({ user_id: "" })],
    ["利用者IDがUUIDでない", JSON.stringify({ user_id: "not-a-uuid" })],
    ["利用者IDが他のパスを含む", JSON.stringify({ user_id: `../${USER_ID}` })],
    ["利用者IDが文字列でない", JSON.stringify({ user_id: 123 })],
    ["利用者IDの項目が無い", JSON.stringify({ id: USER_ID })],
    [
      "本文に利用者ID以外の項目(メールアドレス)がある",
      JSON.stringify({ user_id: USER_ID, email: "a@example.test" }),
    ],
    ["本文が配列", JSON.stringify([{ user_id: USER_ID }])],
    ["本文がオブジェクトでない", JSON.stringify([USER_ID])],
    ["本文がnull", "null"],
    ["本文が壊れている", "{"],
    ["本文が空", ""],
  ])("%sの要求は、400で拒否し、何も置かない", async (_label, body) => {
    // Given
    const bucket = createMemoryBucket();

    // When
    const response = await recordAccountDeletion(
      post(body),
      dependencies(bucket),
    );

    // Then
    expect(response.status).toBe(400);
    expect(bucket.objects.size).toBe(0);
  });

  it.each(["GET", "DELETE", "PUT", "HEAD"])(
    "%sは、読み出しと削除の口が無いため405で拒否し、何も変えない",
    async (method) => {
      // Given
      const bucket = createMemoryBucket();
      bucket.objects.set(`deletions/${USER_ID}`, "first");
      const request = new Request("https://worker.test/", {
        method,
        headers: { Authorization: `Bearer ${AUTH_KEY}` },
      });

      // When
      const response = await recordAccountDeletion(
        request,
        dependencies(bucket),
      );

      // Then
      expect(response.status).toBe(405);
      expect([...bucket.objects.entries()]).toEqual([
        [`deletions/${USER_ID}`, "first"],
      ]);
    },
  );

  it.each(["/deletions/other", "/other"])(
    "パス%sへの要求は、鍵が正しくても404で拒否し、何も置かない",
    async (pathname) => {
      // Given
      const bucket = createMemoryBucket();
      const request = new Request(`https://worker.test${pathname}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${AUTH_KEY}` },
        body: JSON.stringify({ user_id: USER_ID }),
      });

      // When
      const response = await recordAccountDeletion(
        request,
        dependencies(bucket),
      );

      // Then
      expect(response.status).toBe(404);
      expect(bucket.objects.size).toBe(0);
    },
  );

  it("GETは、パスが「/」以外でも、パスより先に405で拒否される", async () => {
    // Given
    const request = new Request("https://worker.test/other", {
      method: "GET",
      headers: { Authorization: `Bearer ${AUTH_KEY}` },
    });

    // When
    const response = await recordAccountDeletion(request, dependencies());

    // Then
    expect(response.status).toBe(405);
  });

  it("鍵が設定されていないWorkerは、正しそうな鍵でも500を返し、何も置かない", async () => {
    // Given
    const bucket = createMemoryBucket();

    // When
    const response = await recordAccountDeletion(
      postUser(USER_ID, "Bearer undefined"),
      { ...dependencies(bucket), authKey: undefined },
    );

    // Then
    expect(response.status).toBe(500);
    expect(bucket.objects.size).toBe(0);
  });
});

describe("R2が失敗するとき", () => {
  it("書込みが失敗し、記録も無いときは、削除を取り消せるように成功でなく失敗を返す", async () => {
    // Given
    const bucket = createMemoryBucket();
    bucket.failPut = true;

    // When
    const response = await recordAccountDeletion(
      postUser(USER_ID),
      dependencies(bucket),
    );

    // Then
    expect(response.status).toBe(502);
    expect(bucket.objects.size).toBe(0);
  });

  it("存在の確認が失敗したときは、失敗を返し、何も置かない", async () => {
    // Given
    const bucket = createMemoryBucket();
    bucket.failHead = true;

    // When
    const response = await recordAccountDeletion(
      postUser(USER_ID),
      dependencies(bucket),
    );

    // Then
    expect(response.status).toBe(502);
    expect(bucket.objects.size).toBe(0);
  });
});
