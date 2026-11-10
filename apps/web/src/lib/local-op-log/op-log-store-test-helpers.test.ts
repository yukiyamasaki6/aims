import { describe, expect, it } from "vitest";
import { createMemoryOpLogStore } from "./memory-op-log-store-test-helpers";
import { loadStreamGroup } from "./op-log-store-test-helpers";

type Op = { eventId: string };

const entry = (eventId: string, streamId: string, userId: string) => ({
  eventId,
  streamId,
  userId,
  operation: { eventId },
});

describe("loadStreamGroup", () => {
  it("現在の利用者のその列の組だけを返す", async () => {
    // Given
    const store = createMemoryOpLogStore<Op, { revision: number }>({
      reflects: () => false,
    });
    await store.append(entry("a", "s1", "u1"));
    await store.append(entry("b", "s2", "u1"));
    await store.append(entry("c", "s1", "u2"));

    // When
    const group = await loadStreamGroup(store, "s1", "u1");

    // Then
    expect(group.entries.map((row) => row.eventId)).toEqual(["a"]);
  });

  it("操作もベースも無い列は、空の組を返す", async () => {
    // Given
    const store = createMemoryOpLogStore<Op, { revision: number }>({
      reflects: () => false,
    });

    // When
    const group = await loadStreamGroup(store, "s1", "u1");

    // Then
    expect(group).toEqual({ base: undefined, entries: [] });
  });
});
