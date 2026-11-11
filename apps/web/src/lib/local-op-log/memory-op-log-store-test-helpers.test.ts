import { describe, expect, it } from "vitest";
import { createMemoryOpLogStore } from "./memory-op-log-store-test-helpers";

type Op = { eventId: string };
type Base = { revision: number };

const store = () =>
  createMemoryOpLogStore<Op, Base>({
    reflects: (base, entry) =>
      entry.ackedRevision !== undefined &&
      (base === null || entry.ackedRevision <= base.revision),
  });

const entry = (
  eventId: string,
  streamId = "s1",
  userId: string | null = "u1",
) => ({
  eventId,
  streamId,
  userId,
  operation: { eventId },
});

describe("createMemoryOpLogStore", () => {
  it("追記に連番を付け、現在の利用者の列だけを読む", async () => {
    // Given
    const s = store();
    await s.append(entry("a"));
    await s.append(entry("b", "s2"));
    await s.append(entry("c", "s1", "u2"));

    // When
    const group = (await s.loadAll("u1")).get("s1");

    // Then
    expect(group?.entries.map((row) => [row.seq, row.eventId])).toEqual([
      [1, "a"],
    ]);
  });

  it("全ての列は、操作かベースを持つ列だけを、現在の利用者のものに限って返す", async () => {
    // Given
    const s = store();
    await s.append(entry("a", "s1"));
    await s.commit("s3", "u1", { revision: 1 }, 10);
    await s.commit("s4", "u2", { revision: 1 }, 10);

    // When
    const all = await s.loadAll("u1");

    // Then
    expect([...all.keys()].sort()).toEqual(["s1", "s3"]);
  });

  it("取得の反映は、新しい取得のベースを採って反映済みの確定の行を消し、古い取得は何も変えない", async () => {
    // Given
    const s = store();
    await s.append(entry("a"));
    await s.ack("a", 1, null);
    await s.commit("s1", "u1", { revision: 2 }, 20);

    // When
    await s.commit("s1", "u1", { revision: 9 }, 10);
    const group = (await s.loadAll("u1")).get("s1");

    // Then
    expect(group?.base).toEqual({ startedAt: 20, base: { revision: 2 } });
    expect(group?.entries).toEqual([]);
  });

  it("確定は1度だけ付き、効いた項目があれば残す。退かせた行は無くなり、閉じても投げない", async () => {
    // Given
    const s = store();
    await s.append(entry("a"));
    await s.append(entry("b"));

    // When
    await s.ack("a", 3, ["name"]);
    await s.ack("a", 9, null);
    await s.ack("missing", 1, null);
    await s.ack("b", null, null);
    await s.retire(["b", "missing"]);

    // Then
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({
      eventId: "a",
      ackedRevision: 3,
      ackedFields: ["name"],
    });
  });

  it("確定のrevisionがnullなら0として付ける", async () => {
    // Given
    const s = store();
    await s.append(entry("a"));

    // When
    await s.ack("a", null, null);

    // Then
    expect(s.rows[0].ackedRevision).toBe(0);
  });

  it("見つからない(null)の反映は、印を保存せずベースの行を消し、確定済みの行を消して未確定の行を残す", async () => {
    // Given
    const s = store();
    await s.append(entry("a"));
    await s.append(entry("b"));
    await s.ack("a", 1, null);
    await s.commit("s1", "u1", { revision: 1 }, 5);

    // When
    await s.commit("s1", "u1", null, 10);
    const group = (await s.loadAll("u1")).get("s1");

    // Then
    expect(group?.base).toBeUndefined();
    expect(group?.entries.map((row) => row.eventId)).toEqual(["b"]);
  });
});
