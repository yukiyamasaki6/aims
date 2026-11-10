import { describe, expect, it, vi } from "vitest";
import { roundBase, roundUpdated } from "../domain/round-op-test-helpers";
import { operationsOf } from "../domain/round-record";
import { roundStreamId, type SyncOperation } from "../domain/sync-events";
import { createTestRoundHub } from "./round-record-test-helpers";

const STREAM = roundStreamId("round-1");

type RecordChange = { streamId: string };

// 記録の規則(保存の完了、世代、利用者の照合)が検証対象で、操作の中身は問わないため、名前だけの更新を使う。
function op(id: string): SyncOperation {
  return roundUpdated({ eventId: id, changes: { name: id } });
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await flush();
  return done;
}

function deferred<T>() {
  return Promise.withResolvers<T>();
}

// 起動して読み込みの完了まで進めた記録。
async function startedHub(
  userId: string | null = "user-1",
  shared: Parameters<typeof createTestRoundHub>[0] = {},
) {
  const tab = createTestRoundHub(shared);
  const changes: RecordChange[] = [];
  tab.hub.subscribe((change) => changes.push(change));
  tab.hub.start(userId);
  await tab.hub.ready();
  return { ...tab, changes };
}

function applied(revision: number, fields: string[] | null = null) {
  return {
    revision,
    applied: true,
    appliedFields: fields,
    hasRejectedFields: false,
  };
}

describe("ready", () => {
  it("起動後の読み込みが終わるまで解決せず、終わると解決する", async () => {
    // Given
    const { hub, store } = createTestRoundHub();
    const loading = deferred<Awaited<ReturnType<typeof store.loadAll>>>();
    vi.spyOn(store, "loadAll").mockReturnValueOnce(loading.promise);
    hub.start("user-1");

    // When
    const ready = hub.ready();
    const beforeLoad = await settled(ready);
    loading.resolve(new Map());
    const afterLoad = await settled(ready);

    // Then
    expect(beforeLoad).toBe(false);
    expect(afterLoad).toBe(true);
  });

  it("読み込みの後に呼ぶとすぐ解決し、startの前は解決しない", async () => {
    // Given
    const { hub } = createTestRoundHub();
    const beforeStart = await settled(hub.ready());
    hub.start("user-1");
    await hub.ready();

    // When
    const afterLoad = await settled(hub.ready());

    // Then
    expect(beforeStart).toBe(false);
    expect(afterLoad).toBe(true);
  });
});

describe("start", () => {
  it("起動時に、現在の利用者の保存済みの全ての列を読んで記録にする", async () => {
    // Given
    const { hub, store } = createTestRoundHub();
    const mine = op("mine");
    await store.append({
      eventId: "mine",
      streamId: STREAM,
      userId: "user-1",
      operation: mine,
    });
    await store.append({
      eventId: "other",
      streamId: roundStreamId("round-2"),
      userId: "user-2",
      operation: op("other"),
    });

    // When
    hub.start("user-1");
    await hub.ready();

    // Then
    expect(hub.streams()).toEqual([STREAM]);
    expect(hub.record(STREAM).items.map((item) => item.eventId)).toEqual([
      "mine",
    ]);
  });
});

describe("読み込みの取り込み", () => {
  it("読み込みの完了前に追記した操作は、読み込みの取り込みで失われない", async () => {
    // Given
    const { hub, store } = createTestRoundHub();
    const gate = deferred<void>();
    const loadAll = store.loadAll.bind(store);
    vi.spyOn(store, "loadAll").mockImplementationOnce(async (userId) => {
      await gate.promise;
      return loadAll(userId);
    });
    hub.start("user-1");

    // When
    await hub.append(STREAM, op("a"));
    gate.resolve();
    await hub.ready();

    // Then
    expect(
      operationsOf(hub.record(STREAM)).map((o) => o.operation.eventId),
    ).toEqual(["a"]);
    expect(hub.record(STREAM).items[0]).toMatchObject({ saved: true });
  });
});

describe("append", () => {
  it("追記は直ちに画面用の列へ入り、保存の完了を知らせ、戻り値は保存の完了後に解決する", async () => {
    // Given
    const { hub, store, changes } = await startedHub();
    const saving = deferred<number>();
    vi.spyOn(store, "append").mockReturnValueOnce(saving.promise);

    // When
    const appended = hub.append(STREAM, op("a"));
    const beforeSave = {
      saved: hub.record(STREAM).items[0]?.saved,
      shown: operationsOf(hub.record(STREAM)).length,
      notified: changes.length,
      settled: await settled(appended),
    };
    saving.resolve(3);
    await appended;

    // Then
    expect(beforeSave).toEqual({
      saved: false,
      shown: 1,
      notified: 1,
      settled: false,
    });
    expect(hub.record(STREAM).items[0]).toMatchObject({ saved: true });
    expect(operationsOf(hub.record(STREAM))).toHaveLength(1);
    expect(changes).toHaveLength(2);
  });

  it("利用者と、このタブのベースを、保存の依頼に渡す", async () => {
    // Given
    const { hub, store } = await startedHub("user-1");
    const append = vi.spyOn(store, "append");
    await hub.commit(STREAM, roundBase(), 10, "user-1");

    // When
    await hub.append(STREAM, op("a"));

    // Then
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "a",
        streamId: STREAM,
        userId: "user-1",
      }),
      { startedAt: 10, base: roundBase() },
    );
  });
});

describe("whenPersisted", () => {
  it("呼んだ時点で保存の途中の操作が全て終わるまで解決しない", async () => {
    // Given
    const { hub, store } = await startedHub();
    const first = deferred<number>();
    const second = deferred<number>();
    vi.spyOn(store, "append")
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    void hub.append(STREAM, op("a"));
    void hub.append(STREAM, op("b"));

    // When
    const persisted = hub.whenPersisted();
    first.resolve(1);
    const afterFirst = await settled(persisted);
    second.resolve(2);
    const afterSecond = await settled(persisted);

    // Then
    expect(afterFirst).toBe(false);
    expect(afterSecond).toBe(true);
  });

  it("保存の途中の操作が無ければ、すぐ解決する", async () => {
    // Given
    const { hub } = await startedHub();

    // When
    const persisted = hub.whenPersisted();

    // Then
    await expect(persisted).resolves.toBeUndefined();
  });
});

describe("applySendResults と discard", () => {
  it("確定した結果を記録と保存先に書き、操作は列に残す", async () => {
    // Given
    const { hub, store } = await startedHub();
    await hub.append(STREAM, op("a"));

    // When
    hub.applySendResults(STREAM, ["a"], [applied(5, ["name"])]);
    await flush();

    // Then
    expect(hub.record(STREAM).items[0]).toMatchObject({
      ackedRevision: 5,
      confirmedFields: ["name"],
    });
    expect(store.rows[0]).toMatchObject({
      eventId: "a",
      ackedRevision: 5,
      ackedFields: ["name"],
    });
  });

  it("効かなかった操作は記録から外して保存先からも退かせ、再取得が要る印を付ける。印は取り直しの開始で消せる", async () => {
    // Given
    const { hub, store } = await startedHub();
    await hub.append(STREAM, op("a"));

    // When
    hub.applySendResults(
      STREAM,
      ["a"],
      [
        {
          revision: null,
          applied: false,
          appliedFields: null,
          hasRejectedFields: false,
        },
      ],
    );
    await flush();
    const marked = hub.divergedStreams().has(STREAM);
    hub.clearDiverged(STREAM);

    // Then
    expect(hub.record(STREAM).items).toEqual([]);
    expect(store.rows).toEqual([]);
    expect(marked).toBe(true);
    expect(hub.divergedStreams().has(STREAM)).toBe(false);
  });

  it("効かなかった結果の印は、購読者への通知の時点で既に付いている", async () => {
    // Given
    const { hub } = await startedHub();
    await hub.append(STREAM, op("a"));
    const seen: boolean[] = [];
    hub.subscribe(() => seen.push(hub.divergedStreams().has(STREAM)));

    // When
    hub.applySendResults(
      STREAM,
      ["a"],
      [
        {
          revision: null,
          applied: false,
          appliedFields: null,
          hasRejectedFields: false,
        },
      ],
    );

    // Then
    expect(seen).toEqual([true]);
  });

  it("効かなかった操作・拒否された操作は、記録から外れた後、取得の反映や別の操作の追記で記録に戻らない", async () => {
    // Given
    const { hub } = await startedHub();
    await hub.append(STREAM, op("ineffective"));
    await hub.append(STREAM, op("rejected"));
    hub.applySendResults(STREAM, ["ineffective"], [ineffective]);
    await hub.discard(STREAM, ["rejected"]);

    // When
    await hub.commit(STREAM, roundBase(), 10, "user-1");
    await hub.append(STREAM, op("later"));

    // Then
    expect(hub.record(STREAM).items.map((item) => item.eventId)).toEqual([
      "later",
    ]);
  });

  it("認可・契約で拒否された操作は、記録から外して保存先からも退かせ、再取得の印は付けない", async () => {
    // Given
    const { hub, store } = await startedHub();
    await hub.append(STREAM, op("a"));

    // When
    await hub.discard(STREAM, ["a"]);

    // Then
    expect(hub.record(STREAM).items).toEqual([]);
    expect(store.rows).toEqual([]);
    expect(hub.divergedStreams().size).toBe(0);
  });
});

describe("commit", () => {
  it("取得したベースを保存して反映し、そのベースに反映済みの確定済みの操作を外す。未確定の操作は残す", async () => {
    // Given
    const { hub, store } = await startedHub();
    await hub.append(STREAM, op("a"));
    await hub.append(STREAM, op("b"));
    hub.applySendResults(STREAM, ["a"], [applied(1)]);
    await flush();

    // When
    await hub.commit(
      STREAM,
      roundBase({ revisions: { round: 1 } }),
      10,
      "user-1",
    );

    // Then
    expect(hub.record(STREAM).items.map((item) => item.eventId)).toEqual(["b"]);
    expect(store.rows.map((row) => row.eventId)).toEqual(["b"]);
    expect(hub.record(STREAM).base?.startedAt).toBe(10);
  });

  it("古い取得で新しいベースを戻さない", async () => {
    // Given
    const { hub } = await startedHub();
    await hub.commit(
      STREAM,
      roundBase({ revisions: { round: 5 } }),
      20,
      "user-1",
    );

    // When
    await hub.commit(
      STREAM,
      roundBase({ revisions: { round: 1 } }),
      10,
      "user-1",
    );

    // Then
    expect(hub.record(STREAM).base).toEqual({
      startedAt: 20,
      base: roundBase({ revisions: { round: 5 } }),
    });
  });

  it("組が消えた後でも、開始時刻が新しくrevisionが古い取得は、保存せず反映しない", async () => {
    // Given
    const { hub, store } = await startedHub();
    await hub.commit(
      STREAM,
      roundBase({ revisions: { round: 2 } }),
      10,
      "user-1",
    );
    const commit = vi.spyOn(store, "commit");

    // When
    await hub.commit(
      STREAM,
      roundBase({ revisions: { round: 1 } }),
      11,
      "user-1",
    );

    // Then
    expect(commit).not.toHaveBeenCalled();
    expect(hub.record(STREAM).base?.startedAt).toBe(10);
  });

  it.each([
    ["別の利用者", "user-2", "user-1"],
    ["記録の利用者がnull(unowned)", "user-1", null],
  ])(
    "%sの取得は、端末へ保存せず、このタブのベースも変えない",
    async (_name, fetchedUser, recordUser) => {
      // Given
      const { hub, store } = await startedHub(recordUser);
      const commit = vi.spyOn(store, "commit");

      // When
      await hub.commit(STREAM, roundBase(), 30, fetchedUser);

      // Then
      expect(commit).not.toHaveBeenCalled();
      expect(hub.record(STREAM).base).toBeUndefined();
      expect((await hub.readStored()).size).toBe(0);
    },
  );

  it("削除の印(null)も、同じ規則で反映する", async () => {
    // Given
    const { hub } = await startedHub();

    // When
    await hub.commit(STREAM, null, 10, "user-1");

    // Then
    expect(hub.record(STREAM).base).toEqual({ startedAt: 10, base: null });
  });

  it("削除済みの後に届いた、開始時刻が古い取得のベースは、保存へ書かず、記録も変えない", async () => {
    // Given
    const { hub, store } = await startedHub();
    await hub.commit(STREAM, roundBase(), 10, "user-1");
    await hub.commit(STREAM, null, 30, "user-1");
    const commit = vi.spyOn(store, "commit");

    // When
    await hub.commit(STREAM, roundBase(), 20, "user-1");

    // Then
    expect(commit).not.toHaveBeenCalled();
    expect(hub.record(STREAM).base).toEqual({ startedAt: 30, base: null });
    expect((await hub.readStored()).has(STREAM)).toBe(false);
  });

  it("削除済みの保存中に届いた、遅れた古い取得と追記は、保存へベースを書き戻さない", async () => {
    // Given
    const { hub, store } = await startedHub();
    await hub.commit(STREAM, roundBase(), 5, "user-1");
    const release = deferred<void>();
    const storeCommit = store.commit.bind(store);
    vi.spyOn(store, "commit").mockImplementationOnce(async (...args) => {
      await release.promise;
      return storeCommit(...args);
    });

    // When
    const deleting = hub.commit(STREAM, null, 30, "user-1");
    const late = hub.commit(STREAM, roundBase(), 20, "user-1");
    const appending = hub.append(STREAM, op("late"));
    release.resolve();
    await Promise.all([deleting, late, appending]);

    // Then
    expect(hub.record(STREAM).base).toEqual({ startedAt: 30, base: null });
    const stored = (await hub.readStored()).get(STREAM);
    expect(stored?.base).toBeUndefined();
    expect(stored?.entries.map((row) => row.eventId)).toEqual(["late"]);
  });

  it("削除済みの保存を待つ間、古い取得と追記は保存へ進まず、解放後の追記はベースを書かない記録で保存する", async () => {
    // Given
    const { hub, store } = await startedHub();
    await hub.commit(STREAM, roundBase(), 5, "user-1");
    const release = deferred<void>();
    const storeCommit = store.commit.bind(store);
    const commit = vi
      .spyOn(store, "commit")
      .mockImplementationOnce(async (...args) => {
        await release.promise;
        return storeCommit(...args);
      });
    const append = vi.spyOn(store, "append");

    // When
    const deleting = hub.commit(STREAM, null, 30, "user-1");
    // 削除の保存が連鎖に入ってから、遅れた取得と追記を投げる(追記は同期で連鎖に入るため)。
    await flush();
    const late = hub.commit(STREAM, roundBase(), 20, "user-1");
    const appending = hub.append(STREAM, op("late"));
    await flush();
    const whileHeld = {
      commits: commit.mock.calls.length,
      appends: append.mock.calls.length,
    };
    release.resolve();
    await Promise.all([deleting, late, appending]);

    // Then
    expect(whileHeld).toEqual({ commits: 1, appends: 0 });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][1]).toEqual({ startedAt: 30, base: null });
  });

  it("別の列の保存は、ある列の保存を待たない。前の保存が失敗しても次を止めない", async () => {
    // Given
    const { hub, store } = await startedHub();
    const release = deferred<void>();
    const storeCommit = store.commit.bind(store);
    vi.spyOn(store, "commit").mockImplementationOnce(async () => {
      await release.promise;
      throw new Error("idb");
    });

    // When
    const failing = hub.commit(STREAM, roundBase(), 10, "user-1");
    const failed = failing.catch((error: Error) => error.message);
    const next = hub.commit(STREAM, roundBase(), 20, "user-1");
    const other = roundStreamId("round-2");
    await hub.commit(other, roundBase(), 10, "user-1");
    const otherDone = hub.record(other).base?.startedAt;
    release.resolve();
    vi.spyOn(store, "commit").mockImplementation(storeCommit);

    // Then
    expect(otherDone).toBe(10);
    expect(await failed).toBe("idb");
    await next;
    expect(hub.record(STREAM).base?.startedAt).toBe(20);
  });

  it("読み込みの完了を待ってから反映する", async () => {
    // Given
    const { hub, store } = createTestRoundHub();
    const loading = deferred<Awaited<ReturnType<typeof store.loadAll>>>();
    vi.spyOn(store, "loadAll").mockReturnValueOnce(loading.promise);
    hub.start("user-1");

    // When
    const committing = hub.commit(STREAM, roundBase(), 10, "user-1");
    const beforeLoad = await settled(committing);
    loading.resolve(new Map());
    await committing;

    // Then
    expect(beforeLoad).toBe(false);
    expect(hub.record(STREAM).base?.startedAt).toBe(10);
  });
});

describe("読み出し", () => {
  it("readStoredは、端末に保存されている現在の利用者の組を返す。メモリにだけある操作は含まない", async () => {
    // Given
    const { hub, store } = createTestRoundHub();
    await store.append({
      eventId: "a",
      streamId: STREAM,
      userId: "user-1",
      operation: op("a"),
    });
    hub.start("user-1");
    await hub.ready();
    // 保存の完了前の操作は、メモリの記録にあって保存先に無い。
    const saving = deferred<number>();
    vi.spyOn(store, "append").mockReturnValueOnce(saving.promise);
    const appending = hub.append(roundStreamId("round-2"), op("unsaved"));

    // When
    const stored = await hub.readStored();
    saving.resolve(2);
    await appending;

    // Then
    expect([...stored.keys()]).toEqual([STREAM]);
  });
});

const ineffective = {
  revision: null,
  applied: false,
  appliedFields: null,
  hasRejectedFields: false,
};

// 一覧の材料で、列ごとの操作のIDを見る。
function operationIds(
  list: Awaited<
    ReturnType<ReturnType<typeof createTestRoundHub>["hub"]["readList"]>
  >,
  streamId: string,
) {
  return list.get(streamId)?.operations.map((entry) => entry.operation.eventId);
}

describe("readList", () => {
  it("追記した操作を、保存の完了前から一覧の材料に載せ、通知する", async () => {
    // Given
    const { hub, store, changes } = await startedHub();
    const saving = deferred<number>();
    vi.spyOn(store, "append").mockReturnValueOnce(saving.promise);
    changes.length = 0;

    // When
    const appending = hub.append(STREAM, op("a"));
    const list = await hub.readList();
    saving.resolve(1);
    await appending;

    // Then
    expect(operationIds(list, STREAM)).toEqual(["a"]);
    expect(changes).toContainEqual({ streamId: STREAM });
  });

  it("確定した操作には確定した項目を付け、取得のベースに反映済みの操作は外し、ベースを載せる", async () => {
    // Given
    const { hub } = await startedHub();
    await hub.append(STREAM, op("reflected"));
    await hub.append(STREAM, op("confirmed"));
    await hub.append(STREAM, op("pending"));
    hub.applySendResults(
      STREAM,
      ["reflected", "confirmed"],
      [applied(1), applied(5, ["name"])],
    );

    // When
    await hub.commit(
      STREAM,
      roundBase({ revisions: { round: 3 } }),
      10,
      "user-1",
    );
    const list = await hub.readList();

    // Then
    expect(list.get(STREAM)?.base?.startedAt).toBe(10);
    expect(list.get(STREAM)?.operations).toEqual([
      { operation: op("confirmed"), confirmedFields: ["name"] },
      { operation: op("pending"), confirmedFields: undefined },
    ]);
  });

  it("削除の印(null)のベースと、効かなかった操作・拒否された操作の除去を、一覧の材料に反映する", async () => {
    // Given
    const { hub } = await startedHub();
    await hub.append(STREAM, op("ineffective"));
    await hub.append(STREAM, op("rejected"));
    await hub.append(STREAM, op("kept"));

    // When
    hub.applySendResults(STREAM, ["ineffective"], [ineffective]);
    await hub.discard(STREAM, ["rejected"]);
    await hub.commit(STREAM, null, 10, "user-1");
    const list = await hub.readList();

    // Then
    expect(list.get(STREAM)?.base).toEqual({ startedAt: 10, base: null });
    expect(operationIds(list, STREAM)).toEqual(["kept"]);
  });

  it("別のタブが保存先へ加えた操作は、再読み込みまで一覧の材料に載らない", async () => {
    // Given
    const first = await startedHub();
    const second = await startedHub("user-1", { store: first.store });

    // When
    await second.hub.append(STREAM, op("other-tab"));
    const list = await first.hub.readList();
    const restarted = await startedHub("user-1", { store: first.store });

    // Then
    expect([...list.keys()]).toEqual([]);
    expect(operationIds(await restarted.hub.readList(), STREAM)).toEqual([
      "other-tab",
    ]);
  });
});
