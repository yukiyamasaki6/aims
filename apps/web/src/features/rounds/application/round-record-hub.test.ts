import { describe, expect, it, vi } from "vitest";
import { roundBase, roundUpdated } from "../domain/round-op-test-helpers";
import { operationsOf } from "../domain/round-record";
import { roundStreamId, type SyncOperation } from "../domain/sync-events";
import type { RecordChange } from "./round-record-hub";
import { createTestRoundHub } from "./round-record-test-helpers";

const STREAM = roundStreamId("round-1");

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

  it("読み込みの後に呼ぶとすぐ解決し、startの前とstopの後は解決しない", async () => {
    // Given
    const { hub } = createTestRoundHub();
    const beforeStart = await settled(hub.ready());
    hub.start("user-1");
    await hub.ready();

    // When
    const afterLoad = await settled(hub.ready());
    hub.stop();
    const afterStop = await settled(hub.ready());

    // Then
    expect(beforeStart).toBe(false);
    expect(afterLoad).toBe(true);
    expect(afterStop).toBe(false);
  });

  it("読み込みに失敗しても解決する", async () => {
    // Given
    const { hub, store } = createTestRoundHub();
    vi.spyOn(store, "loadAll").mockRejectedValue(new Error("idb"));
    hub.start("user-1");

    // When
    const isSettled = await settled(hub.ready());

    // Then
    expect(isSettled).toBe(true);
  });

  it("停止して起動し直した後は、新しい読み込みが終わるまで解決せず、古い世代の読み込みの完了では解決しない", async () => {
    // Given
    const { hub, store } = createTestRoundHub();
    const first = deferred<Awaited<ReturnType<typeof store.loadAll>>>();
    const second = deferred<Awaited<ReturnType<typeof store.loadAll>>>();
    vi.spyOn(store, "loadAll")
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    hub.start("user-1");
    hub.stop();
    hub.start("user-2");
    const ready = hub.ready();

    // When
    first.resolve(new Map());
    const afterStale = await settled(ready);
    second.resolve(new Map());
    const afterCurrent = await settled(ready);

    // Then
    expect(afterStale).toBe(false);
    expect(afterCurrent).toBe(true);
  });
});

describe("start と stop", () => {
  it("stopで記録を捨てる", async () => {
    // Given
    const { hub } = createTestRoundHub();
    hub.start("user-1");
    await hub.ready();
    await hub.append(STREAM, op("a"));

    // When
    hub.stop();

    // Then
    expect(hub.streams()).toEqual([]);
  });

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
    expect(hub.record(STREAM).items[0]).toMatchObject({ saved: true, seq: 3 });
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

  it("保存に失敗しても拒否せず、メモリの記録で続ける(再読み込みでは残らない)", async () => {
    // Given
    const { hub, store } = await startedHub();
    vi.spyOn(store, "append").mockRejectedValueOnce(new Error("quota"));

    // When
    const appended = hub.append(STREAM, op("a"));

    // Then
    await expect(appended).resolves.toBeUndefined();
    const [item] = hub.record(STREAM).items;
    expect(item).toMatchObject({ saved: true, seq: undefined });
    expect((await hub.readList()).get(STREAM)?.operations).toHaveLength(1);
    expect((await hub.readStored()).size).toBe(0);
  });
});

describe("whenPersisted", () => {
  it("呼んだ時点で保存の途中の操作の完了(失敗を含む)まで解決しない", async () => {
    // Given
    const { hub, store } = await startedHub();
    const saving = deferred<number>();
    vi.spyOn(store, "append")
      .mockReturnValueOnce(saving.promise)
      .mockRejectedValueOnce(new Error("quota"));
    void hub.append(STREAM, op("a"));
    void hub.append(STREAM, op("b"));

    // When
    const persisted = hub.whenPersisted();
    const beforeSave = await settled(persisted);
    saving.resolve(1);
    const afterSave = await settled(persisted);

    // Then
    expect(beforeSave).toBe(false);
    expect(afterSave).toBe(true);
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

  it("保存先への書き込みに失敗しても、記録は進める", async () => {
    // Given
    const { hub, store } = await startedHub();
    await hub.append(STREAM, op("a"));
    vi.spyOn(store, "ack").mockRejectedValue(new Error("idb"));

    // When
    hub.applySendResults(STREAM, ["a"], [applied(1)]);
    await flush();

    // Then
    expect(hub.record(STREAM).items[0].ackedRevision).toBe(1);
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

  it("送信中の目印を付けた操作は、取得の反映で保存先に無くても外れない", async () => {
    // Given
    const { hub, store } = await startedHub();
    await hub.append(STREAM, op("a"));
    store.rows.length = 0;
    hub.replaceInFlight(STREAM, ["a"]);

    // When
    await hub.commit(STREAM, null, 1, "user-1");
    const whileSending = hub.record(STREAM).items.length;
    hub.replaceInFlight(STREAM, []);
    await hub.commit(STREAM, null, 2, "user-1");

    // Then
    expect(whileSending).toBe(1);
    expect(hub.record(STREAM).items).toEqual([]);
  });

  it("印の集合が変わらない列と、記録が無い列では、記録を作り直さず、通知もしない", async () => {
    // Given
    const { hub } = await startedHub();
    await hub.append(STREAM, op("a"));
    hub.replaceInFlight(STREAM, ["a"]);
    const marked = hub.record(STREAM);
    const listener = vi.fn();
    hub.subscribe(listener);

    // When
    hub.replaceInFlight(STREAM, ["a"]);
    hub.replaceInFlight(roundStreamId("missing"), ["x"]);
    const missing = hub.record(roundStreamId("missing")).items;

    // Then
    expect(hub.record(STREAM)).toBe(marked);
    expect(missing).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("commit", () => {
  it("取得したベースを保存して反映し、そのベースに反映済みの確定済みの操作を外して、組を返す。送信中の操作は残す", async () => {
    // Given
    const { hub, store } = await startedHub();
    await hub.append(STREAM, op("a"));
    await hub.append(STREAM, op("b"));
    hub.applySendResults(STREAM, ["a"], [applied(1)]);
    await flush();
    hub.replaceInFlight(STREAM, ["b"]);

    // When
    const group = await hub.commit(
      STREAM,
      roundBase({ revisions: { round: 1 } }),
      10,
      "user-1",
    );

    // Then
    expect(group.base?.startedAt).toBe(10);
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
    const group = await hub.commit(
      STREAM,
      roundBase({ revisions: { round: 1 } }),
      11,
      "user-1",
    );

    // Then
    expect(commit).not.toHaveBeenCalled();
    expect(group.base?.startedAt).toBe(10);
    expect(hub.record(STREAM).base?.startedAt).toBe(10);
  });

  it.each([
    ["別の利用者", "user-2", "user-1"],
    ["記録の利用者がnull(unowned)", "user-1", null],
  ])(
    "%sの取得は、端末へ保存せず、このタブのベースも変えず、現在の組を返す",
    async (_name, fetchedUser, recordUser) => {
      // Given
      const { hub, store } = await startedHub(recordUser);
      const commit = vi.spyOn(store, "commit");

      // When
      const group = await hub.commit(STREAM, roundBase(), 30, fetchedUser);

      // Then
      expect(commit).not.toHaveBeenCalled();
      expect(group).toEqual({ base: undefined, entries: [] });
      expect(hub.record(STREAM).base).toBeUndefined();
      expect((await hub.readStored()).size).toBe(0);
    },
  );

  it("保存に失敗しても、このタブのベースを取得したものにする", async () => {
    // Given
    const { hub, store } = await startedHub();
    vi.spyOn(store, "commit").mockRejectedValueOnce(new Error("quota"));

    // When
    const group = await hub.commit(STREAM, roundBase(), 10, "user-1");

    // Then
    expect(hub.record(STREAM).base?.base).toEqual(roundBase());
    expect(group.base?.startedAt).toBe(10);
  });

  it("保存の完了が遅れる間に停止・起動されたら、現在の記録へ取り込まず、通知もせず、空の組を返す", async () => {
    // Given
    const { hub, store, changes } = await startedHub("user-1");
    const saving = deferred<Awaited<ReturnType<typeof store.commit>>>();
    vi.spyOn(store, "commit").mockReturnValueOnce(saving.promise);
    const committing = hub.commit(STREAM, roundBase(), 10, "user-1");
    await flush();
    hub.stop();
    hub.start("user-2");
    await hub.ready();
    changes.length = 0;

    // When
    saving.resolve({
      base: { startedAt: 10, base: roundBase() },
      entries: [
        {
          seq: 1,
          eventId: "old",
          streamId: STREAM,
          userId: "user-1",
          operation: op("old"),
        },
      ],
    });
    const group = await committing;

    // Then
    expect(group).toEqual({ base: undefined, entries: [] });
    expect(hub.record(STREAM).base).toBeUndefined();
    expect(hub.record(STREAM).items).toEqual([]);
    expect(changes).toEqual([]);
  });

  it("削除の印(null)も、同じ規則で反映する", async () => {
    // Given
    const { hub } = await startedHub();

    // When
    await hub.commit(STREAM, null, 10, "user-1");

    // Then
    expect(hub.record(STREAM).base).toEqual({ startedAt: 10, base: null });
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
  it("readは、読み込みの完了後に、現在の利用者のその列だけを返す。保存の読み込みの失敗は投げる", async () => {
    // Given
    const { hub, store } = createTestRoundHub();
    const rows = [
      ["mine", "user-1", STREAM],
      ["other", "user-2", STREAM],
      ["elsewhere", "user-1", roundStreamId("round-2")],
    ] as const;
    for (const [id, userId, streamId] of rows) {
      await store.append({ eventId: id, streamId, userId, operation: op(id) });
    }
    hub.start("user-1");

    // When
    const { entries } = await hub.read(STREAM);
    vi.spyOn(store, "loadStream").mockRejectedValueOnce(new Error("idb"));

    // Then
    expect(entries.map((entry) => entry.eventId)).toEqual(["mine"]);
    await expect(hub.read(STREAM)).rejects.toThrow("idb");
  });

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
    vi.spyOn(store, "append").mockRejectedValueOnce(new Error("quota"));
    await hub.append(roundStreamId("round-2"), op("memory-only"));

    // When
    const stored = await hub.readStored();

    // Then
    expect([...stored.keys()]).toEqual([STREAM]);
  });
});

const STREAM_2 = roundStreamId("round-2");

// 保存先を共有する2つのタブ。通知の経路は無く、保存先だけで繋がる。保存先の組の消失(完了)は、メモリの保存が保持の規則を持たないため、行を消して表す。
async function sharedTabs(userId = "user-1") {
  const first = await startedHub(userId);
  const second = () => startedHub(userId, { store: first.store });
  return { first, second };
}

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
  describe("保存を基準にした一覧の材料", () => {
    it("保存の組から画面用の形を作り、確定の反映が済んでいない行は除き、確定した行には確定した項目を付ける", async () => {
      // Given
      const { hub, store } = await startedHub();
      await hub.append(STREAM, op("pending"));
      await hub.append(STREAM, op("confirmed"));
      await hub.append(STREAM, op("unfit"));
      await store.ack("confirmed", 3, true, ["name"]);
      await store.ack("unfit", null, false, null);
      await hub.commit(STREAM, roundBase(), 10, "user-1");

      // When
      const list = await hub.readList();

      // Then
      expect(list.get(STREAM)?.base?.startedAt).toBe(10);
      expect(list.get(STREAM)?.operations).toEqual([
        { operation: op("pending"), confirmedFields: undefined },
        { operation: op("confirmed"), confirmedFields: ["name"] },
      ]);
    });

    it("別のタブの追記と削除の印が、通知なしで材料に載る", async () => {
      // Given
      const { first, second } = await sharedTabs();
      const other = await second();

      // When
      await first.hub.append(STREAM, op("a"));
      await first.hub.commit(STREAM_2, null, 10, "user-1");
      const list = await other.hub.readList();

      // Then
      expect(operationIds(list, STREAM)).toEqual(["a"]);
      expect(list.get(STREAM_2)?.base).toEqual({ startedAt: 10, base: null });
    });

    it("別のタブが完了して保存の組が消えた列は、メモリに入力中で持っていても載らず、再読み込み後の材料と一致する", async () => {
      // Given
      const { first, second } = await sharedTabs();
      await first.hub.append(STREAM, op("a"));
      const other = await second();
      first.store.rows.length = 0;

      // When
      const list = await other.hub.readList();
      const reloaded = await (await second()).hub.readList();

      // Then
      expect(other.hub.record(STREAM).items).toHaveLength(1);
      expect([...list.keys()]).toEqual([]);
      expect(list).toEqual(reloaded);
    });

    it("保存に無く書き込み失敗の列にも無い列は、確定済みの操作だけがメモリに残っていても載らない", async () => {
      // Given
      const { hub, store } = await startedHub();
      await hub.append(STREAM, op("confirmed"));
      hub.applySendResults(STREAM, ["confirmed"], [applied(4)]);
      await flush();
      store.rows.length = 0;

      // When
      const list = await hub.readList();

      // Then
      expect(hub.record(STREAM).items).toHaveLength(1);
      expect([...list.keys()]).toEqual([]);
    });
  });

  describe("保存先の読み取りの失敗", () => {
    it("読み取りが失敗しても拒否せず、全ての列をメモリから作り、復旧後の次の呼び出しでは保存を基準に戻る", async () => {
      // Given
      const { hub, store } = await startedHub();
      await hub.append(STREAM, op("a"));
      vi.spyOn(store, "loadAll").mockRejectedValueOnce(new Error("idb"));

      // When
      const duringFailure = await hub.readList();
      store.rows.length = 0;
      const afterRecovery = await hub.readList();

      // Then
      expect(operationIds(duringFailure, STREAM)).toEqual(["a"]);
      expect([...afterRecovery.keys()]).toEqual([]);
    });

    it("書き込みに失敗した列は、読み取りの復旧後もメモリから作る", async () => {
      // Given
      const { hub, store } = await startedHub();
      vi.spyOn(store, "append").mockRejectedValueOnce(new Error("quota"));
      await hub.append(STREAM, op("a"));
      vi.spyOn(store, "loadAll").mockRejectedValueOnce(new Error("idb"));
      await hub.readList();

      // When
      const afterRecovery = await hub.readList();

      // Then
      expect(operationIds(afterRecovery, STREAM)).toEqual(["a"]);
    });
  });

  describe("書き込みの1種類の失敗", () => {
    it("追記だけが失敗した列は、保存に無い操作がメモリにだけある入力中として載る", async () => {
      // Given
      const { hub, store } = await startedHub();
      await hub.append(STREAM, op("saved"));
      vi.spyOn(store, "append").mockRejectedValueOnce(new Error("quota"));
      await hub.append(STREAM, op("memory-only"));

      // When
      const list = await hub.readList();

      // Then
      expect(operationIds(list, STREAM)).toEqual(["saved", "memory-only"]);
    });

    it("commitだけが失敗した列は、メモリのベースが一覧から落ちず載る", async () => {
      // Given
      const { hub, store } = await startedHub();
      vi.spyOn(store, "commit").mockRejectedValueOnce(new Error("idb"));
      await hub.commit(STREAM, roundBase(), 10, "user-1");

      // When
      const list = await hub.readList();

      // Then
      expect(list.get(STREAM)?.base?.startedAt).toBe(10);
    });

    it("ackだけが失敗した列は、保存の未確定の行で上書きされず、メモリの確定した内容で載る", async () => {
      // Given
      const { hub, store } = await startedHub();
      await hub.append(STREAM, op("a"));
      vi.spyOn(store, "ack").mockRejectedValue(new Error("idb"));
      hub.applySendResults(STREAM, ["a"], [applied(4, ["name"])]);
      await flush();

      // When
      const list = await hub.readList();

      // Then
      expect(store.rows[0].ackedRevision).toBeUndefined();
      expect(list.get(STREAM)?.operations).toEqual([
        { operation: op("a"), confirmedFields: ["name"] },
      ]);
    });

    it("discardのretireだけが失敗した列は、拒否された操作が保存に残った行から戻らない", async () => {
      // Given
      const { hub, store } = await startedHub();
      await hub.append(STREAM, op("rejected"));
      vi.spyOn(store, "retire").mockRejectedValueOnce(new Error("idb"));
      await hub.discard(STREAM, ["rejected"]);

      // When
      const list = await hub.readList();

      // Then
      expect(store.rows).toHaveLength(1);
      expect(operationIds(list, STREAM)).toEqual([]);
    });

    it("効かなかった操作の除去のretireだけが失敗した列は、除去済みの操作が保存に残った行から戻らない", async () => {
      // Given
      const { hub, store } = await startedHub();
      await hub.append(STREAM, op("unfit"));
      vi.spyOn(store, "retire").mockRejectedValueOnce(new Error("idb"));
      hub.applySendResults(STREAM, ["unfit"], [ineffective]);
      await flush();

      // When
      const list = await hub.readList();

      // Then
      expect(store.rows).toHaveLength(1);
      expect(operationIds(list, STREAM)).toEqual([]);
    });
  });

  describe("書き込みの失敗を経た列", () => {
    // 失敗した追記の後に保存が復旧し、続く追記は保存に成功した状態にする。
    async function failedThenRecovered() {
      const { first, second } = await sharedTabs();
      const failing = first;
      vi.spyOn(failing.store, "append").mockRejectedValueOnce(
        new Error("quota"),
      );
      await failing.hub.append(STREAM, op("memory-only"));
      await failing.hub.append(STREAM, op("saved"));
      await failing.hub.append(STREAM_2, op("healthy"));
      return { failing, second };
    }

    it("別のタブが完了しても再読み込みまで入力中として残り、新しく起動したハブでは完了した状態になる。保存に成功した操作は失われない", async () => {
      // Given
      const { failing, second } = await failedThenRecovered();
      const beforeCompletion = await (await second()).hub.readList();
      failing.store.rows.length = 0;

      // When
      const list = await failing.hub.readList();
      const reloaded = await (await second()).hub.readList();

      // Then
      expect(operationIds(beforeCompletion, STREAM)).toEqual(["saved"]);
      expect(operationIds(list, STREAM)).toEqual(["memory-only", "saved"]);
      expect([...reloaded.keys()]).toEqual([]);
    });

    it("失敗を経ていない別の列は、同じ操作で保存を基準になる", async () => {
      // Given
      const { failing } = await failedThenRecovered();
      failing.store.rows.length = 0;

      // When
      const list = await failing.hub.readList();

      // Then
      expect([...list.keys()]).toEqual([STREAM]);
    });

    it.each([
      [
        "停止して起動し直した",
        async (hub: ReturnType<typeof createTestRoundHub>["hub"]) => {
          hub.stop();
          hub.start("user-1");
          await hub.ready();
        },
      ],
    ])(
      "%s後は失敗の記録が空になり、材料は保存を基準にする",
      async (_name, restart) => {
        // Given
        const { failing } = await failedThenRecovered();
        await restart(failing.hub);
        failing.store.rows.length = 0;

        // When
        const list = await failing.hub.readList();

        // Then
        expect([...list.keys()]).toEqual([]);
      },
    );

    it("詳細を開く読み取りは保存の内容を返し、別のタブが完了した後は完了した状態を返す", async () => {
      // Given
      const { failing } = await failedThenRecovered();
      const beforeCompletion = await failing.hub.read(STREAM);
      failing.store.rows.length = 0;

      // When
      const afterCompletion = await failing.hub.read(STREAM);

      // Then
      expect(beforeCompletion.entries.map((row) => row.eventId)).toEqual([
        "saved",
      ]);
      expect(afterCompletion.entries).toEqual([]);
    });

    it("送信と確定の判定は失敗の記録に影響されず、失敗を経た列の送信が続く", async () => {
      // Given
      const { failing } = await failedThenRecovered();

      // When
      failing.hub.applySendResults(STREAM, ["memory-only"], [applied(7)]);
      await flush();

      // Then
      expect(
        failing.hub.record(STREAM).items.map((item) => item.ackedRevision),
      ).toEqual([7, undefined]);
    });
  });

  describe("競合で効かなかった記録の別のタブでの表示", () => {
    it("保存の内容が確定した後は、別のタブの材料と読み取りが効かなかった値を含まず、取り直しの印は記録したタブだけに付く", async () => {
      // Given
      const { first, second } = await sharedTabs();
      await first.hub.commit(STREAM, roundBase({ name: "古い" }), 5, "user-1");
      const other = await second();
      await first.hub.append(STREAM, op("conflicted"));

      // When
      first.hub.applySendResults(STREAM, ["conflicted"], [ineffective]);
      await flush();
      await first.hub.commit(
        STREAM,
        roundBase({ name: "他端末" }),
        20,
        "user-1",
      );
      const list = await other.hub.readList();
      const stored = await other.hub.read(STREAM);

      // Then
      expect(list.get(STREAM)?.base?.startedAt).toBe(20);
      expect(operationIds(list, STREAM)).toEqual([]);
      expect(stored.entries).toEqual([]);
      expect(first.hub.divergedStreams().has(STREAM)).toBe(true);
      expect(other.hub.divergedStreams().has(STREAM)).toBe(false);
    });
  });

  describe("停止・起動をまたぐ読み込み", () => {
    it("読み込みの間に停止・起動されたら、その結果を返さず読み直す", async () => {
      // Given
      const { hub, store } = await startedHub("user-1");
      const old = deferred<Awaited<ReturnType<typeof store.loadAll>>>();
      const load = vi.spyOn(store, "loadAll").mockReturnValueOnce(old.promise);
      const reading = hub.readList();
      await flush();
      hub.stop();
      hub.start("user-2");

      // When
      old.resolve(
        new Map([
          [
            STREAM,
            {
              base: undefined,
              entries: [
                {
                  seq: 1,
                  eventId: "old",
                  streamId: STREAM,
                  userId: "user-1",
                  operation: op("old"),
                },
              ],
            },
          ],
        ]),
      );
      const list = await reading;

      // Then
      expect(list.size).toBe(0);
      expect(load).toHaveBeenLastCalledWith("user-2");
    });
  });
});

describe("停止・起動をまたぐ処理", () => {
  const row = (id: string, userId: string) => ({
    seq: 1,
    eventId: id,
    streamId: STREAM,
    userId,
    operation: op(id),
  });

  it("readは、読み込みの間に停止・起動されたら、その結果を返さず読み直す", async () => {
    // Given
    const { hub, store } = await startedHub("user-1");
    const old = deferred<Awaited<ReturnType<typeof store.loadStream>>>();
    const load = vi.spyOn(store, "loadStream").mockReturnValueOnce(old.promise);
    const reading = hub.read(STREAM);
    await flush();
    hub.stop();
    hub.start("user-2");

    // When
    old.resolve({ base: undefined, entries: [row("old", "user-1")] });
    const group = await reading;

    // Then
    expect(group.entries).toEqual([]);
    expect(load).toHaveBeenLastCalledWith(STREAM, "user-2");
  });

  it("readStoredは、読み込みの間に停止・起動されたら、その結果を返さず読み直す", async () => {
    // Given
    const { hub, store } = await startedHub("user-1");
    const old = deferred<Awaited<ReturnType<typeof store.loadAll>>>();
    const load = vi.spyOn(store, "loadAll").mockReturnValueOnce(old.promise);
    const reading = hub.readStored();
    await flush();
    hub.stop();
    hub.start("user-2");

    // When
    old.resolve(
      new Map([[STREAM, { base: undefined, entries: [row("old", "user-1")] }]]),
    );
    const all = await reading;

    // Then
    expect(all.size).toBe(0);
    expect(load).toHaveBeenLastCalledWith("user-2");
  });

  it("appendの保存の完了が停止・起動より遅れても、現在の記録に触れず、通知もしない", async () => {
    // Given
    const { hub, store, changes } = await startedHub("user-1");
    const saving = deferred<void>();
    const save = store.append.bind(store);
    vi.spyOn(store, "append").mockImplementationOnce(async (...args) => {
      await saving.promise;
      return save(...args);
    });
    const appending = hub.append(STREAM, op("a"));
    await flush();
    hub.stop();
    hub.start("user-2");
    await hub.ready();
    changes.length = 0;

    // When
    saving.resolve();
    await appending;

    // Then
    expect(hub.record(STREAM).items).toEqual([]);
    expect(changes).toEqual([]);
  });

  it("送信の間に停止・起動されたときのapplySendResultsは、現在の記録・印・通知に触れず、保存先の確定だけを書く", async () => {
    // Given
    const { hub, store, changes } = await startedHub("user-1");
    await hub.append(STREAM, op("a"));
    const generation = hub.generation();
    hub.stop();
    hub.start("user-2");
    await hub.ready();
    changes.length = 0;

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
      generation,
    );
    await flush();

    // Then
    expect(hub.divergedStreams().size).toBe(0);
    expect(changes).toEqual([]);
    expect(store.rows).toEqual([]);
  });
});
