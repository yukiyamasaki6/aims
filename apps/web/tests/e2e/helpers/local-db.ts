import { expect } from "@playwright/test";
import { Client } from "pg";

// ローカルのテスト用DBだけに接続する。ホストが手元でなければ、本番へ向けた書き換えを避けるため実行しない。
const LOCAL_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
// 競合のテストで、ロックの待ちが解けないときに接続を残さないための上限。
const SESSION_TIMEOUT = "15s";

async function connectLocalDb(): Promise<Client> {
  const connectionString = process.env.E2E_DATABASE_URL ?? LOCAL_DATABASE_URL;
  const url = new URL(connectionString);
  // `?host=`などのクエリは、検査したホストと別の接続先へ向けられるため認めない。
  if (!LOCAL_HOSTS.has(url.hostname) || url.search !== "")
    throw new Error(
      "E2Eのテスト用DBは、クエリを含まないローカルのホストの接続文字列だけを使える。",
    );
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

export async function withLocalDb<T>(
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await connectLocalDb();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

export type DbSession = { client: Client; pid: number };

async function openSession(): Promise<DbSession> {
  const client = await connectLocalDb();
  await client.query(`set lock_timeout = '${SESSION_TIMEOUT}'`);
  await client.query(`set statement_timeout = '${SESSION_TIMEOUT}'`);
  const { rows } = await client.query<{ pid: number }>(
    "select pg_backend_pid() as pid",
  );
  return { client, pid: rows[0].pid };
}

// 指定した本数の接続を開き、終わりに、開いた順に取り消して閉じる。先の接続のロックを解くと、待っていた後の接続が進む。
export async function withDbSessions<T>(
  count: number,
  run: (sessions: DbSession[]) => Promise<T>,
): Promise<T> {
  const sessions: DbSession[] = [];
  try {
    while (sessions.length < count) sessions.push(await openSession());
    return await run(sessions);
  } finally {
    for (const { client } of sessions) {
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  }
}

// 接続のトランザクションを開き、認証済みの利用者としてRPCを呼べる状態にする。
export async function beginAs(session: DbSession, userId: string) {
  await session.client.query("begin");
  await session.client.query("set local role authenticated");
  await session.client.query(
    "select set_config('request.jwt.claims', $1, true)",
    [JSON.stringify({ sub: userId, role: "authenticated" })],
  );
}

// 接続の実行中の文が、ロックを待つ状態になるまで待つ。
export async function expectWaitingForLock(session: DbSession) {
  await withLocalDb((observer) =>
    expect
      .poll(
        async () => {
          const { rows } = await observer.query<{ type: string | null }>(
            "select wait_event_type as type from pg_stat_activity where pid = $1",
            [session.pid],
          );
          return rows[0]?.type;
        },
        { timeout: 10_000 },
      )
      .toBe("Lock"),
  );
}

// ラウンドの参加の行を、作る操作の無い役割で直接加える。番号を省くと代理の人にする。
export function addParticipant(input: {
  roundId: string;
  userId: string;
  shooterNumber?: number;
}) {
  const role = input.shooterNumber === undefined ? "editor" : "owner";
  return withLocalDb((client) =>
    client.query(
      `insert into public.round_users (round_id, user_id, role, shooter_number)
       values ($1, $2, $3, $4)`,
      [input.roundId, input.userId, role, input.shooterNumber ?? null],
    ),
  );
}
