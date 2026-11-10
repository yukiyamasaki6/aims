import { describe, expect, it, vi } from "vitest";
import {
  distanceCreated,
  roundBase,
  roundCreated,
  roundUpdated,
  shotRecorded,
} from "../domain/round-op-test-helpers";
import { roundStreamId } from "../domain/sync-events";
import type { TargetFaceOption } from "../domain/target-face";
import type { OpenedRound } from "./refresh-requests";
import {
  createRoundHandle,
  type LoadedRound,
  type RoundHandle,
} from "./round-handle";
import { createTestRounds, settleRoundNow } from "./round-record-test-helpers";

const STREAM = roundStreamId("round-1");

const face: TargetFaceOption = {
  id: "face-1",
  name: "122cm",
  size: 122,
  format: "outdoor",
  bow_type: ["recurve"],
  target_face_spots: [
    {
      center_x: 0,
      center_y: 0,
      target_face_rings: [
        {
          radius: 10,
          color: "#fff",
          line_color: null,
          z_index: 2,
          score_str: "10",
          score_int: 10,
        },
      ],
    },
  ],
};

// 実物のハブ・依頼の記録・編集の手続きで、ラウンドごとに1つの handle を作る(窓口が行う再利用の代わり)。
function createTab(options: Parameters<typeof createTestRounds>[0] = {}) {
  const tab = createTestRounds(options);
  const handles = new Map<string, RoundHandle>();
  return {
    ...tab,
    round(roundId: string) {
      let handle = handles.get(roundId);
      if (!handle) {
        handle = createRoundHandle(
          { hub: tab.hub, requests: tab.requests, editing: tab.editing },
          roundId,
        );
        handles.set(roundId, handle);
      }
      return handle;
    },
  };
}

const opened = (deleted = false): OpenedRound => ({
  deleted,
  base: roundBase({ name: "取得した" }).tables,
  targetFaces: [face],
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("round(...)", () => {
  function loadedOf(overrides: Partial<LoadedRound> = {}): LoadedRound {
    return {
      base: roundBase({
        distances: [
          {
            id: "d-1",
            position_key: "a",
            distance: 70,
            total_ends: 6,
            arrows_per_end: 6,
            target_face_id: "face-1",
            is_marked: true,
          },
        ],
      }).tables,
      targetFaces: [face],
      pendingCreationEventId: null,
      ...overrides,
    };
  }

  it("開く前の状態はnullで、印を付けた時点から状態を持つ", () => {
    // Given
    const tab = createTab();
    const handle = tab.round("round-1");

    // When
    const before = handle.getSnapshot();
    const unwatch = handle.watch(loadedOf());
    const after = handle.getSnapshot();
    unwatch();

    // Then
    expect(before.state).toBeNull();
    expect(after.state?.roundConfig.name).toBe("午前練習");
    expect(after.gone).toBe(false);
  });

  it("peekは、印を付けず副作用なしに、開いた材料へ記録の操作を重ねた今の状態を返す", async () => {
    // Given
    const tab = createTab();
    const handle = tab.round("round-1");
    await tab.hub.append(STREAM, roundUpdated({ changes: { name: "未送信" } }));

    // When
    const peeked = handle.peek(loadedOf());

    // Then
    expect(peeked.roundConfig.name).toBe("未送信");
    expect(tab.requests.watched()).toEqual([]);
    expect(handle.getSnapshot().state).toBeNull();
  });

  it("最後の印を外すと状態を捨て、開き直した最初の描画で前の状態を見せない", async () => {
    // Given
    const tab = createTab();
    const handle = tab.round("round-1");
    const unwatch = handle.watch(loadedOf());
    handle.append(shotRecorded());
    await tab.hub.whenPersisted();
    unwatch();

    // When
    const snapshot = handle.getSnapshot();
    const peeked = handle.peek(loadedOf());

    // Then
    expect(snapshot.state).toBeNull();
    expect(peeked.roundConfig.name).toBe("午前練習");
  });

  it("購読を解除すると、状態が変わっても知らせない", async () => {
    // Given
    const tab = createTab();
    const handle = tab.round("round-1");
    const unwatch = handle.watch(loadedOf());
    const listener = vi.fn();
    handle.subscribe(listener)();

    // When
    handle.append(shotRecorded());
    await tab.hub.whenPersisted();

    // Then
    expect(listener).not.toHaveBeenCalled();
    unwatch();
  });

  it("開いている間の印を付け、解除で外す", () => {
    // Given
    const tab = createTab();
    const handle = tab.round("round-1");

    // When
    const first = handle.watch(loadedOf());
    const marked = tab.requests.watched();
    first();

    // Then
    expect(marked).toEqual([{ roundId: "round-1" }]);
    expect(tab.requests.watched()).toEqual([]);
  });

  it("他で削除されたとき(削除の印)は、goneにする", async () => {
    // Given
    const tab = createTab();
    const handle = tab.round("round-1");
    const unwatch = handle.watch(loadedOf());

    // When
    await tab.hub.commit(STREAM, null, 10, "user-1");

    // Then
    expect(handle.getSnapshot().gone).toBe(true);
    unwatch();
  });

  it("取り直しでサーバーにラウンドが無いと分かったとき、開き方によらずgoneにする", () => {
    // Given
    const tab = createTab();
    const first = tab.round("first");
    const second = tab.round("second");
    const unwatchFirst = first.watch(loadedOf());
    const unwatchSecond = second.watch(loadedOf());

    // When
    settleRoundNow(tab.requests, "first", { status: "not-found" });
    settleRoundNow(tab.requests, "second", { status: "not-found" });

    // Then
    expect(first.getSnapshot().gone).toBe(true);
    expect(second.getSnapshot().gone).toBe(true);
    unwatchFirst();
    unwatchSecond();
  });

  it("作成が未確定のラウンドは、取り直しがgoneを記録しても、見つかりませんにしない", () => {
    // Given
    const tab = createTab();
    const handle = tab.round("pending");
    const unwatch = handle.watch(
      loadedOf({ pendingCreationEventId: roundCreated().eventId }),
    );

    // When
    settleRoundNow(tab.requests, "pending", { status: "not-found" });

    // Then
    expect(tab.requests.outcomeOf("pending")).toBe("gone");
    expect(handle.getSnapshot().gone).toBe(false);
    unwatch();
  });

  it("後に始めた取り直しが成功した後に、先に始めた取り直しがサーバーにラウンドが無いと終わっても、削除扱いにならない", () => {
    // Given
    const tab = createTab();
    const local = tab.round("local");
    const unwatch = local.watch(loadedOf());
    const earlier = tab.requests.beginRound("local");
    const later = tab.requests.beginRound("local");

    // When
    tab.requests.settleRound(later, { status: "ok", data: opened() });
    tab.requests.settleRound(earlier, { status: "not-found" });

    // Then
    expect(local.getSnapshot().gone).toBe(false);
    unwatch();
  });

  it.each([
    ["新しい取り直しが先に終わり、古い取り直しが後に成功で終わる", "新しい"],
    ["古い取り直しが先に成功で終わり、新しい取り直しが後に終わる", "古い"],
  ] as const)(
    "後に始めた取り直しがサーバーにラウンドが無いと終わったときは、%s場合でも削除扱い(gone)になる",
    (_name, first) => {
      // Given
      const tab = createTab();
      const local = tab.round("local");
      const unwatch = local.watch(loadedOf());
      const earlier = tab.requests.beginRound("local");
      const later = tab.requests.beginRound("local");
      const settleEarlier = () =>
        tab.requests.settleRound(earlier, { status: "ok", data: opened() });
      const settleLater = () =>
        tab.requests.settleRound(later, { status: "not-found" });

      // When
      if (first === "新しい") {
        settleLater();
        settleEarlier();
      } else {
        settleEarlier();
        settleLater();
      }

      // Then
      expect(local.getSnapshot().gone).toBe(true);
      unwatch();
    },
  );

  describe("確定していない作成", () => {
    const created = roundCreated();
    const opening = (): LoadedRound =>
      ({
        base: roundBase().tables,
        targetFaces: [face],
        pendingCreationEventId: created.eventId,
      }) as LoadedRound;

    it("確定を見ずに記録から消えたとき、creationGoneにする", async () => {
      // Given
      const tab = createTab();
      const handle = tab.round("round-1");
      await tab.hub.append(STREAM, created);
      const unwatch = handle.watch(opening());

      // When
      await tab.hub.discard(STREAM, [created.eventId]);

      // Then
      expect(handle.getSnapshot().creationGone).toBe(true);
      unwatch();
    });

    it("確定した後に消えたときは、creationGoneにしない", async () => {
      // Given
      const tab = createTab();
      const handle = tab.round("round-1");
      await tab.hub.append(STREAM, created);
      const unwatch = handle.watch(opening());
      tab.hub.applySendResults(
        STREAM,
        [created.eventId],
        [
          {
            revision: 1,
            applied: true,
            appliedFields: null,
            hasRejectedFields: false,
          },
        ],
      );

      // When
      await tab.hub.discard(STREAM, [created.eventId]);

      // Then
      expect(handle.getSnapshot().creationGone).toBe(false);
      unwatch();
    });
  });

  it("確定済みの操作をベースに重ねられないとき、取り直しが要る印を付け、印を外すと消す", async () => {
    // Given
    const tab = createTab();
    const handle = tab.round("round-1");
    const base = roundBase({
      distances: [
        {
          id: "d-1",
          position_key: "a",
          distance: 70,
          total_ends: 1,
          arrows_per_end: 1,
          target_face_id: "face-1",
          is_marked: true,
        },
      ],
      shots: [
        {
          id: "s-0",
          distance_id: "d-1",
          end_number: 1,
          score_str: "10",
          score_int: 10,
          shot_number: null,
        },
      ],
    });
    await tab.hub.commit(STREAM, base, 10, "user-1");
    const confirmed = shotRecorded({ shotId: "s-1" });
    await tab.hub.append(STREAM, confirmed);
    tab.hub.applySendResults(
      STREAM,
      [confirmed.eventId],
      [
        {
          revision: 9,
          applied: true,
          appliedFields: null,
          hasRejectedFields: false,
        },
      ],
    );

    // When
    const unwatch = handle.watch(loadedOf({ base: base.tables }));
    const marked = tab.requests.overlayNeeded("round-1");
    unwatch();

    // Then
    expect(marked).toBe(true);
    expect(tab.requests.overlayNeeded("round-1")).toBe(false);
  });
  describe("画面用の操作が変わったときだけ作り直す", () => {
    // 保存の完了を、テストが解放するまで止める。
    function holdSaving(tab: ReturnType<typeof createTab>) {
      const saving = Promise.withResolvers<void>();
      const save = tab.opLog.append.bind(tab.opLog);
      vi.spyOn(tab.opLog, "append").mockImplementationOnce(async (...args) => {
        await saving.promise;
        return save(...args);
      });
      return saving;
    }

    // 取得したベースがエンドの空きを使い切り、確定済みの操作を重ねられない状態を作る。
    async function overlayCase() {
      const tab = createTab();
      const handle = tab.round("round-1");
      const base = roundBase({
        distances: [
          {
            id: "d-1",
            position_key: "a",
            distance: 70,
            total_ends: 1,
            arrows_per_end: 1,
            target_face_id: "face-1",
            is_marked: true,
          },
        ],
        shots: [
          {
            id: "s-0",
            distance_id: "d-1",
            end_number: 1,
            score_str: "10",
            score_int: 10,
            shot_number: null,
          },
        ],
      });
      await tab.hub.commit(STREAM, base, 10, "user-1");
      const confirmed = shotRecorded({ shotId: "s-1" });
      await tab.hub.append(STREAM, confirmed);
      tab.hub.applySendResults(
        STREAM,
        [confirmed.eventId],
        [
          {
            revision: 9,
            applied: true,
            appliedFields: null,
            hasRejectedFields: false,
          },
        ],
      );
      return { tab, handle, base };
    }

    it("保存の前の追記で、画面の値が新しくなり聞き手が1回呼ばれる。保存の完了では値も聞き手も変わらない", async () => {
      // Given
      const tab = createTab();
      const handle = tab.round("round-1");
      const unwatch = handle.watch(loadedOf());
      const listener = vi.fn();
      handle.subscribe(listener);
      const first = handle.getSnapshot();
      const saving = holdSaving(tab);

      // When
      const appending = tab.hub.append(STREAM, shotRecorded());
      await flush();
      const duringSave = {
        snapshot: handle.getSnapshot(),
        calls: listener.mock.calls.length,
      };
      saving.resolve();
      await appending;

      // Then
      expect(duringSave.snapshot).not.toBe(first);
      expect(duringSave.snapshot.state?.shots).toHaveLength(1);
      expect(duringSave.calls).toBe(1);
      expect(handle.getSnapshot()).toBe(duringSave.snapshot);
      expect(listener).toHaveBeenCalledTimes(1);
      unwatch();
    });

    it("保存を保留しても、設定の保存で要約が直ちに変わる", async () => {
      // Given
      const tab = createTab();
      const handle = tab.round("round-1");
      const unwatch = handle.watch(loadedOf());
      const saving = holdSaving(tab);

      // When
      handle.append(roundUpdated({ changes: { name: "新" } }));
      await flush();
      const duringSave = handle.getSnapshot().state?.roundConfig.name;
      saving.resolve();
      await tab.hub.whenPersisted();

      // Then
      expect(duringSave).toBe("新");
      expect(handle.getSnapshot().state?.roundConfig.name).toBe("新");
      unwatch();
    });

    it("作成が未確定の詳細では、保存の前の追記でも作成の消失の判定が働く", async () => {
      // Given
      const created = roundCreated();
      const opening = (): LoadedRound => ({
        base: roundBase().tables,
        targetFaces: [face],
        pendingCreationEventId: created.eventId,
      });
      const tab = createTab();
      const handle = tab.round("round-1");
      const listener = vi.fn();
      handle.subscribe(listener);
      const saving = holdSaving(tab);
      const appending = tab.hub.append(STREAM, created);
      await flush();

      // When
      const unwatch = handle.watch(opening());
      const beforeGone = handle.getSnapshot().creationGone;
      await tab.hub.discard(STREAM, [created.eventId]);
      saving.resolve();
      await appending;

      // Then
      expect(beforeGone).toBe(false);
      expect(handle.getSnapshot().creationGone).toBe(true);
      expect(listener).toHaveBeenCalled();
      unwatch();
    });

    it("取り直しの印が付くとき、聞き手は1回だけ呼ばれ、値は1回だけ変わる(入れ子の再計算が起きない)", async () => {
      // Given
      const { tab, handle, base } = await overlayCase();
      const listener = vi.fn();
      const delivered: unknown[] = [];
      handle.subscribe(() => {
        listener();
        delivered.push(handle.getSnapshot());
      });
      const initial = handle.getSnapshot();

      // When
      const unwatch = handle.watch(loadedOf({ base: base.tables }));

      // Then
      expect(listener).toHaveBeenCalledTimes(1);
      expect(new Set(delivered).size).toBe(1);
      expect(handle.getSnapshot()).not.toBe(initial);
      expect(handle.getSnapshot()).toBe(delivered[0]);
      expect(tab.requests.overlayNeeded("round-1")).toBe(true);
      unwatch();
    });

    it("取り直しの印が外れるとき、聞き手は1回だけ呼ばれ、値は変わる", async () => {
      // Given
      const { tab, handle, base } = await overlayCase();
      const listener = vi.fn();
      handle.subscribe(listener);
      const unwatch = handle.watch(loadedOf({ base: base.tables }));
      listener.mockClear();
      const withMark = handle.getSnapshot();
      const wider = roundBase({
        distances: [
          {
            id: "d-1",
            position_key: "a",
            distance: 70,
            total_ends: 6,
            arrows_per_end: 6,
            target_face_id: "face-1",
            is_marked: true,
          },
        ],
        shots: [
          {
            id: "s-0",
            distance_id: "d-1",
            end_number: 1,
            score_str: "10",
            score_int: 10,
            shot_number: null,
          },
        ],
        revisions: { round: 2 },
      });

      // When
      await tab.hub.commit(STREAM, wider, 20, "user-1");

      // Then
      expect(listener).toHaveBeenCalledTimes(1);
      expect(handle.getSnapshot()).not.toBe(withMark);
      expect(tab.requests.overlayNeeded("round-1")).toBe(false);
      unwatch();
    });

    it("入れ子の途中で記録が変わったとき、外側が古い値で上書きしない", async () => {
      // Given
      const { tab, handle, base } = await overlayCase();
      const rename = roundUpdated({
        eventId: "rename",
        changes: { name: "改名" },
      });
      await tab.hub.append(STREAM, rename);
      let discarded = false;
      tab.requests.subscribe(() => {
        if (!discarded && tab.requests.overlayNeeded("round-1")) {
          discarded = true;
          void tab.hub.discard(STREAM, [rename.eventId]);
        }
      });

      // When
      const unwatch = handle.watch(loadedOf({ base: base.tables }));
      await flush();

      // Then
      expect(handle.getSnapshot().state?.roundConfig.name).toBe("午前練習");
      expect(tab.requests.overlayNeeded("round-1")).toBe(true);
      unwatch();
    });

    it("取り直しの結果だけが変わるとき、画面の状態は作り直さず、goneが変わったときだけ知らせる", () => {
      // Given
      const tab = createTab();
      const handle = tab.round("round-1");
      const unwatch = handle.watch(loadedOf());
      const listener = vi.fn();
      handle.subscribe(listener);
      const before = handle.getSnapshot();

      // When
      settleRoundNow(tab.requests, "round-1", { status: "ok", data: opened() });
      const afterOk = {
        snapshot: handle.getSnapshot(),
        calls: listener.mock.calls.length,
      };
      settleRoundNow(tab.requests, "round-1", { status: "not-found" });

      // Then
      expect(afterOk.snapshot).toBe(before);
      expect(afterOk.calls).toBe(0);
      expect(handle.getSnapshot().gone).toBe(true);
      expect(handle.getSnapshot().state).toBe(before.state);
      expect(listener).toHaveBeenCalledTimes(1);
      unwatch();
    });

    it("開き直しでは前回の値を使わず、新しい開いたときの材料から作り直す", () => {
      // Given
      const tab = createTab();
      const handle = tab.round("round-1");
      const first = handle.watch(loadedOf());
      const firstSnapshot = handle.getSnapshot();
      first();

      // When
      const second = handle.watch(
        loadedOf({
          base: roundBase({ name: "別のラウンド", distances: [] }).tables,
        }),
      );

      // Then
      expect(handle.getSnapshot().state?.roundConfig.name).toBe("別のラウンド");
      expect(handle.getSnapshot()).not.toBe(firstSnapshot);
      second();
    });
  });
});

describe("round(...).append: 完了のラウンドへの編集", () => {
  const distance = {
    id: "d-1",
    position_key: "a",
    distance: 70,
    total_ends: 6,
    arrows_per_end: 6,
    target_face_id: "face-1",
    is_marked: true,
  };
  const recordedShot = {
    id: "s-1",
    distance_id: "d-1",
    end_number: 1,
    score_str: "10",
    score_int: 10,
    shot_number: null,
    shooter_id: "user-1",
  };

  function loadedOf(
    status: "in_progress" | "completed",
    shots: (typeof recordedShot)[] = [],
  ): LoadedRound {
    return {
      base: roundBase({ status, name: "元", distances: [distance], shots })
        .tables,
      targetFaces: [face],
      pendingCreationEventId: null,
    };
  }

  const typesOf = (tab: ReturnType<typeof createTab>) =>
    tab.hub.record(STREAM).items.map((item) => item.operation.type);

  it("表示が変わる矢の記録を追記すると、続けて状態を入力中に戻す操作も同じ列に積み、その操作のイベントIDは払い出された値である", async () => {
    // Given
    const tab = createTab();
    const handle = tab.round("round-1");
    handle.watch(loadedOf("completed"));
    expect(handle.getSnapshot().state?.status).toBe("completed");

    // When
    handle.append(shotRecorded());
    await tab.hub.whenPersisted();
    await flush();

    // Then
    const items = tab.hub.record(STREAM).items;
    expect(items.map((item) => item.operation.type)).toEqual([
      "shot.recorded",
      "round.updated",
    ]);
    expect(items[1].operation.eventId).toBe("event-1");
    expect(handle.getSnapshot().state?.status).toBe("in_progress");
  });

  it("完了のラウンドの距離の編集(距離の追加)でも、続けて入力中へ戻す操作が積まれる", async () => {
    // Given
    const tab = createTab();
    const handle = tab.round("round-1");
    handle.watch(loadedOf("completed"));

    // When
    handle.append(distanceCreated({ id: "d-2", positionKey: "b" }));
    await tab.hub.whenPersisted();
    await flush();

    // Then
    expect(typesOf(tab)).toEqual(["distance.created", "round.updated"]);
    expect(handle.getSnapshot().state?.status).toBe("in_progress");
  });

  it("ラウンド設定の変更では、完了のまま戻さない", async () => {
    // Given
    const tab = createTab();
    const handle = tab.round("round-1");
    handle.watch(loadedOf("completed"));

    // When
    handle.append(roundUpdated({ changes: { name: "新" } }));
    await tab.hub.whenPersisted();
    await flush();

    // Then
    expect(typesOf(tab)).toEqual(["round.updated"]);
    expect(handle.getSnapshot().state?.status).toBe("completed");
    expect(handle.getSnapshot().state?.roundConfig.name).toBe("新");
  });

  it("入力中のラウンドへの記録では、状態を変える操作を積まない", async () => {
    // Given
    const tab = createTab();
    const handle = tab.round("round-1");
    handle.watch(loadedOf("in_progress"));

    // When
    handle.append(shotRecorded());
    await tab.hub.whenPersisted();
    await flush();

    // Then
    expect(typesOf(tab)).toEqual(["shot.recorded"]);
    expect(handle.getSnapshot().state?.status).toBe("in_progress");
  });

  it("完了のラウンドで、変化の無い記録(記録済みの矢に同じ点数を書く)では積まない", async () => {
    // Given
    const tab = createTab();
    const handle = tab.round("round-1");
    handle.watch(loadedOf("completed", [recordedShot]));

    // When
    handle.append(
      shotRecorded({ shotId: "s-1", scoreStr: "10", scoreInt: 10 }),
    );
    await tab.hub.whenPersisted();
    await flush();

    // Then
    expect(typesOf(tab)).toEqual(["shot.recorded"]);
    expect(handle.getSnapshot().state?.status).toBe("completed");
  });

  it("入力中に戻った後に続けて記録しても、戻す操作を重ねて積まない", async () => {
    // Given
    const tab = createTab();
    const handle = tab.round("round-1");
    handle.watch(loadedOf("completed"));
    handle.append(shotRecorded());
    await tab.hub.whenPersisted();
    await flush();
    expect(handle.getSnapshot().state?.status).toBe("in_progress");

    // When
    handle.append(
      shotRecorded({ eventId: "e-shot-2", shotId: "s-2", endNumber: 2 }),
    );
    await tab.hub.whenPersisted();
    await flush();

    // Then
    expect(typesOf(tab)).toEqual([
      "shot.recorded",
      "round.updated",
      "shot.recorded",
    ]);
  });

  it("未反映のまま連続して2件を追記しても、最終の状態は入力中である", async () => {
    // Given
    const tab = createTab();
    const handle = tab.round("round-1");
    handle.watch(loadedOf("completed"));

    // When
    handle.append(shotRecorded());
    handle.append(
      shotRecorded({ eventId: "e-shot-2", shotId: "s-2", endNumber: 2 }),
    );
    await tab.hub.whenPersisted();
    await flush();

    // Then
    expect(handle.getSnapshot().state?.status).toBe("in_progress");
  });

  it("画面を開く前(印を付ける前)の追記は、何も積まずに例外にする", () => {
    // Given
    const tab = createTab();
    const handle = tab.round("round-1");

    // When
    const append = () => handle.append(shotRecorded());

    // Then
    expect(append).toThrow();
    expect(typesOf(tab)).toEqual([]);
  });

  it("印を外した後の追記は、何も積まずに例外にする", () => {
    // Given
    const tab = createTab();
    const handle = tab.round("round-1");
    const unwatch = handle.watch(loadedOf("completed"));
    unwatch();

    // When
    const append = () => handle.append(shotRecorded());

    // Then
    expect(append).toThrow();
    expect(typesOf(tab)).toEqual([]);
  });

  it("画面の状態は、保存の完了前に追記の結果が反映済みである", async () => {
    // Given
    const tab = createTab();
    const handle = tab.round("round-1");
    handle.watch(loadedOf("in_progress"));
    const saving = Promise.withResolvers<number>();
    vi.spyOn(tab.opLog, "append").mockReturnValue(saving.promise);

    // When
    handle.append(shotRecorded());
    await flush();
    const shotsBeforeSave = handle.getSnapshot().state?.shots.length;
    saving.resolve(1);
    await tab.hub.whenPersisted();

    // Then
    expect(shotsBeforeSave).toBe(1);
    expect(handle.getSnapshot().state?.shots).toHaveLength(1);
  });

  it("追記の戻りは、追記の直後(同期)に結果の画面の状態を持ち、再開が要るときは入力中に戻った状態を持つ", () => {
    // Given
    const tab = createTab();
    const handle = tab.round("round-1");
    handle.watch(loadedOf("completed"));

    // When
    const state = handle.append(shotRecorded());

    // Then
    expect(state.shots).toHaveLength(1);
    expect(state.status).toBe("in_progress");
    expect(handle.getSnapshot().state).toBe(state);
  });
});
