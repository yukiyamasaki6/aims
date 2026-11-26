// 削除の記録のWorker(docs/backup.md)の本体。
// delete_accountが削除と同じトランザクションで送る利用者IDを、R2のdeletions/<利用者ID>へ置く。読み出しと削除の口は持たない。
// R2のバケットは約束(DeletionLogBucket)で受け、テストでは代役に差し替える。

// R2のバケットのうち、この本体が使う部分。R2Bucketのhead・putと同じ形。
export type DeletionLogBucket = {
  head(key: string): Promise<unknown>;
  put(key: string, value: string): Promise<unknown>;
};

export type AccountDeletionRecordDependencies = {
  bucket: DeletionLogBucket;
  // delete_accountと共有する鍵。Vaultのaccount_deletion_log_keyと同じ値。
  authKey: string | undefined;
  now: () => Date;
};

const DELETIONS_PREFIX = "deletions/";
const RECORD_PATH = "/";
const USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// 成功は2xx、それ以外は失敗で、delete_accountは2xx以外で削除を取り消す。
export async function recordAccountDeletion(
  request: Request,
  dependencies: AccountDeletionRecordDependencies,
): Promise<Response> {
  const { bucket, authKey, now } = dependencies;
  if (!authKey) {
    return new Response(null, { status: 500 });
  }
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  // 受け付けるのは根(VaultのWorkerのURL)だけ。他のパスに口を持たない。
  if (new URL(request.url).pathname !== RECORD_PATH) {
    return new Response(null, { status: 404 });
  }
  if (!isAuthorized(request.headers.get("Authorization"), authKey)) {
    return new Response(null, { status: 401 });
  }
  const userId = await readUserId(request);
  if (userId === undefined) {
    return new Response(null, { status: 400 });
  }

  const objectKey = `${DELETIONS_PREFIX}${userId}`;
  try {
    // 既にあれば成功にする。バケットロックで上書きできないため。
    if (await bucket.head(objectKey)) {
      return new Response(null, { status: 200 });
    }
    const record = { user_id: userId, recorded_at: now().toISOString() };
    await bucket.put(objectKey, JSON.stringify(record));
    return new Response(null, { status: 201 });
  } catch {
    return (await existsAfterFailure(bucket, objectKey))
      ? new Response(null, { status: 200 })
      : new Response(null, { status: 502 });
  }
}

// 同じ利用者の同時の記録で、先に置かれた後の上書きが拒否されたときは成功にする。
async function existsAfterFailure(
  bucket: DeletionLogBucket,
  objectKey: string,
): Promise<boolean> {
  try {
    return Boolean(await bucket.head(objectKey));
  } catch {
    return false;
  }
}

function isAuthorized(header: string | null, authKey: string): boolean {
  const prefix = "Bearer ";
  if (header === null || !header.startsWith(prefix)) {
    return false;
  }
  return equalsInConstantTime(header.slice(prefix.length), authKey);
}

// 鍵の比較にかかる時間から、一致した長さを推測させないため。
function equalsInConstantTime(actual: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(actual);
  const b = encoder.encode(expected);
  if (a.length !== b.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

async function readUserId(request: Request): Promise<string | undefined> {
  try {
    const body: unknown = await request.json();
    // 本文は利用者IDだけを持つ。余分な項目(メールアドレスなど)を含む要求は受け付けない。
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !("user_id" in body)
    ) {
      return undefined;
    }
    const userId = body.user_id;
    return typeof userId === "string" && USER_ID_PATTERN.test(userId)
      ? userId
      : undefined;
  } catch {
    return undefined;
  }
}
