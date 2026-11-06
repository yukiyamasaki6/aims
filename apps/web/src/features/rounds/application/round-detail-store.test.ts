import { describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../domain/fetch-status";
import { FALLBACK_WAIT_MS, FETCH_TIMEOUT_MS } from "../domain/fetch-wait";
import {
  roundBase,
  roundCreated,
  roundDisabled,
  roundUpdated,
} from "../domain/round-op-test-helpers";
import { roundStreamId } from "../domain/sync-events";
import type { TargetFaceOption } from "../domain/target-face";
import type { OpenedRound } from "./refresh-requests";
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

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await flush();
  return done;
}

const opened = (deleted = false): OpenedRound => ({
  deleted,
  base: roundBase({ name: "取得した" }).tables,
  targetFaces: [face],
});

// 端末のベースで開ける組(入力中のベースと、保存した的)を持つ状態。
async function withLocalBase(savedFaces: TargetFaceOption[] | null = [face]) {
  const tab = createTestRounds({ savedFaces });
  await tab.hub.ready();
  await tab.hub.commit(STREAM, roundBase({ name: "端末" }), 10, "user-1");
  return tab;
}

// 一括の取得が終わった。
function _syncFinishesAll(
  requests: ReturnType<typeof createTestRounds>["requests"],
  result: FetchResult<null> = { status: "ok", data: null },
) {
  const run1 = requests.beginAll();
  requests.settleAll(run1, result);
}

describe("load", () => {
  it("端末の記録にラウンドの削除があれば、取得せずに削除として返す", async () => {
    // Given
    const tab = createTestRounds();
    await tab.hub.append(STREAM, roundDisabled());

    // When
    const result = await tab.detail.load("round-1");

    // Then
    expect(result).toEqual({ status: "ok", data: { deleted: true } });
    expect(tab.requests.pendingOpens()).toEqual([]);
    expect(tab.fetching.fetchTargetFaces).not.toHaveBeenCalled();
  });

  it("作成が未確定なら、取得せずに的だけを取得し、作成の操作を基準にして、作成のeventIdを返す", async () => {
    // Given
    const tab = createTestRounds();
    const created = roundCreated({ name: "新規" });
    await tab.hub.append(STREAM, created);
    tab.fetching.fetchTargetFaces.mockResolvedValue({
      status: "ok",
      data: [face],
    });

    // When
    const result = await tab.detail.load("round-1");

    // Then
    expect(result).toMatchObject({
      status: "ok",
      data: {
        deleted: false,
        pendingCreationEventId: created.eventId,
        targetFaces: [face],
        source: "server",
        base: { round: { config: { name: "新規" } } },
      },
    });
    expect(tab.requests.pendingOpens()).toEqual([]);
  });

  it("作成が未確定で、的の取得に失敗したときは、その失敗を返す", async () => {
    // Given
    const tab = createTestRounds();
    await tab.hub.append(STREAM, roundCreated());
    tab.fetching.fetchTargetFaces.mockResolvedValue({ status: "offline" });

    // When
    const result = await tab.detail.load("round-1");

    // Then
    expect(result).toEqual({ status: "offline" });
  });

  it("取得の依頼を記録し、取り直しの結果を待って返す。結果のsourceはserver", async () => {
    // Given
    const tab = createTestRounds();
    const loading = tab.detail.load("round-1");
    await flush();
    const requested = tab.requests.pendingOpens();

    // When
    settleRoundNow(tab.requests, "round-1", { status: "ok", data: opened() });
    const result = await loading;

    // Then
    expect(requested).toEqual(["round-1"]);
    expect(result).toMatchObject({
      status: "ok",
      data: {
        deleted: false,
        source: "server",
        pendingCreationEventId: null,
        targetFaces: [face],
      },
    });
  });

  it("取得した材料が削除を含むときは、削除として返し、見つからないときはnot-foundを返す", async () => {
    // Given
    const tab = createTestRounds();
    const deleted = tab.detail.load("round-1");
    await flush();
    settleRoundNow(tab.requests, "round-1", {
      status: "ok",
      data: opened(true),
    });
    const missing = tab.detail.load("round-2");
    await flush();

    // When
    settleRoundNow(tab.requests, "round-2", { status: "not-found" });

    // Then
    expect(await deleted).toEqual({ status: "ok", data: { deleted: true } });
    expect(await missing).toEqual({ status: "not-found" });
  });

  it("端末の記録を読み込み、メモリの記録に取り込む", async () => {
    // Given
    const tab = createTestRounds();
    await tab.opLog.append({
      eventId: "pending",
      streamId: STREAM,
      userId: "user-1",
      operation: roundUpdated({ eventId: "pending" }),
    });
    void tab.detail.load("round-1");

    // When
    await flush();

    // Then
    expect(tab.hub.record(STREAM).items.map((item) => item.eventId)).toEqual([
      "pending",
    ]);
  });

  it("端末の記録を読めなくても、取得を依頼して続ける", async () => {
    // Given
    const tab = createTestRounds();
    vi.spyOn(tab.hub, "read").mockRejectedValue(new Error("idb"));
    const loading = tab.detail.load("round-1");
    await flush();

    // When
    settleRoundNow(tab.requests, "round-1", { status: "ok", data: opened() });

    // Then
    expect(await loading).toMatchObject({
      status: "ok",
      data: { source: "server" },
    });
  });

  describe("端末のベースで開けるとき", () => {
    it("FALLBACK_WAIT_MS以内に取得が済めば、取得の結果で開く", async () => {
      // Given
      const tab = await withLocalBase();
      const loading = tab.detail.load("round-1");
      await flush();

      // When
      settleRoundNow(tab.requests, "round-1", { status: "ok", data: opened() });
      const result = await loading;

      // Then
      expect(result).toMatchObject({
        status: "ok",
        data: { source: "server" },
      });
    });

    it("FALLBACK_WAIT_MSを待っても取得が済まなければ、端末のベースと保存した的で開く(source=local)", async () => {
      // Given
      const tab = await withLocalBase();
      const loading = tab.detail.load("round-1");

      // When
      await tab.clock.advanceAsync(FALLBACK_WAIT_MS);
      const result = await loading;

      // Then
      expect(result).toMatchObject({
        status: "ok",
        data: {
          deleted: false,
          source: "local",
          targetFaces: [face],
          base: { round: { config: { name: "端末" } } },
        },
      });
    });

    it("取得が上限の前に失敗(offline、error)で済んだときも、端末のベースで開く", async () => {
      // Given
      const tab = await withLocalBase();
      const loading = tab.detail.load("round-1");
      await flush();

      // When
      settleRoundNow(tab.requests, "round-1", { status: "offline" });
      const result = await loading;

      // Then
      expect(result).toMatchObject({ status: "ok", data: { source: "local" } });
    });

    it("サーバーにラウンドが無いと分かったときは、端末のベースで開かず、そのまま返す", async () => {
      // Given
      const tab = await withLocalBase();
      const loading = tab.detail.load("round-1");
      await flush();

      // When
      settleRoundNow(tab.requests, "round-1", { status: "not-found" });

      // Then
      expect(await loading).toEqual({ status: "not-found" });
    });

    it("保存した的が無いときは、端末のベースで開かず、取得の完了を待つ", async () => {
      // Given
      const tab = await withLocalBase(null);
      const loading = tab.detail.load("round-1");
      await tab.clock.advanceAsync(FALLBACK_WAIT_MS);
      const waiting = await settled(loading);

      // When
      settleRoundNow(tab.requests, "round-1", { status: "ok", data: opened() });

      // Then
      expect(waiting).toBe(false);
      expect(await loading).toMatchObject({
        status: "ok",
        data: { source: "server" },
      });
    });

    it("完了でも、未送信の操作が残るときは、端末のベースで開く", async () => {
      // Given
      const tab = createTestRounds({ savedFaces: [face] });
      await tab.hub.ready();
      await tab.hub.commit(
        STREAM,
        roundBase({ status: "completed" }),
        10,
        "user-1",
      );
      await tab.hub.append(
        STREAM,
        roundUpdated({ changes: { name: "未送信" } }),
      );
      const loading = tab.detail.load("round-1");

      // When
      await tab.clock.advanceAsync(FALLBACK_WAIT_MS);

      // Then
      expect(await loading).toMatchObject({
        status: "ok",
        data: { source: "local" },
      });
    });
  });

  describe("打ち切り", () => {
    it("取得が終わらないまま、FETCH_TIMEOUT_MSでerrorにする", async () => {
      // Given
      const tab = createTestRounds();
      const loading = tab.detail.load("round-1");

      // When
      await tab.clock.advanceAsync(FETCH_TIMEOUT_MS - 1);
      const early = await settled(loading);
      await tab.clock.advanceAsync(1);

      // Then
      expect(early).toBe(false);
      expect(await loading).toEqual({
        status: "error",
        reason: "failed",
      });
    });

    it("打ち切りの時点で切断なら、offlineにする", async () => {
      // Given
      const tab = createTestRounds();
      const loading = tab.detail.load("round-1");
      tab.connectivity.goOffline();

      // When
      await tab.clock.advanceAsync(FETCH_TIMEOUT_MS);

      // Then
      expect(await loading).toEqual({ status: "offline" });
    });

    it("端末の記録の読み込みが終わらない間に打ち切られても、切断ならofflineにする(詳細)", async () => {
      // Given
      const tab = createTestRounds();
      vi.spyOn(tab.hub, "read").mockReturnValue(new Promise(() => {}));
      const detail = tab.detail.load("round-1");
      tab.connectivity.goOffline();

      // When
      await tab.clock.advanceAsync(FETCH_TIMEOUT_MS);

      // Then
      expect(await detail).toEqual({ status: "offline" });
    });

    it("打ち切りの後に届いた結果も、端末の記録には反映される(取得を止めない)", async () => {
      // Given
      const tab = createTestRounds();
      const loading = tab.detail.load("round-1");
      await tab.clock.advanceAsync(FETCH_TIMEOUT_MS);
      await loading;

      // When
      settleRoundNow(tab.requests, "round-1", { status: "ok", data: opened() });

      // Then
      expect(tab.requests.outcomeOf("round-1")).toBe("ok");
    });
  });
});

describe("再読み込み", () => {
  it("「もう一度読む」でloadを呼び直すと、依頼の記録が増え、取得と反映は行わない(依頼を記録するだけ)", async () => {
    // Given
    const tab = createTestRounds();
    void tab.detail.load("round-1");
    await flush();
    settleRoundNow(tab.requests, "round-1", { status: "offline" });
    expect(tab.requests.pendingOpens()).toEqual([]);

    // When
    void tab.detail.load("round-1");
    await flush();

    // Then
    expect(tab.requests.pendingOpens()).toEqual(["round-1"]);
    expect(tab.fetching.fetchRoundDetail).not.toHaveBeenCalled();
    expect(tab.fetching.fetchRoundDetails).not.toHaveBeenCalled();
  });
});

describe("whenOnline", () => {
  it("オフラインなら呼ばずに待ち、次に通信が戻ったときに1回だけ呼ぶ", () => {
    // Given
    const tab = createTestRounds({ offline: true });
    const listener = vi.fn();
    tab.detail.whenOnline(listener);
    const calledBeforeReturn = listener.mock.calls.length;

    // When
    tab.connectivity.goOnline();

    // Then
    expect(calledBeforeReturn).toBe(0);
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("completeRound", () => {
  it("手続きのcompleteRoundへ同じ引数を渡し、その完了まで解決しない", async () => {
    // Given
    const tab = createTestRounds();
    const pending = Promise.withResolvers<void>();
    tab.leaving.completeRound.mockReturnValue(pending.promise);

    // When
    const running = tab.detail.completeRound("round-1");
    const resolvedBeforeRelease = await settled(running);
    pending.resolve();

    // Then
    expect(tab.leaving.completeRound).toHaveBeenCalledExactlyOnceWith(
      "round-1",
    );
    expect(resolvedBeforeRelease).toBe(false);
    await expect(running).resolves.toBeUndefined();
  });
});

describe("deleteRoundAndLeave", () => {
  it("手続きのdeleteRoundAndLeaveへ同じ引数を渡し、その完了まで解決しない", async () => {
    // Given
    const tab = createTestRounds();
    const pending = Promise.withResolvers<void>();
    tab.leaving.deleteRoundAndLeave.mockReturnValue(pending.promise);

    // When
    const running = tab.detail.deleteRoundAndLeave("round-1");
    const resolvedBeforeRelease = await settled(running);
    pending.resolve();

    // Then
    expect(tab.leaving.deleteRoundAndLeave).toHaveBeenCalledExactlyOnceWith(
      "round-1",
    );
    expect(resolvedBeforeRelease).toBe(false);
    await expect(running).resolves.toBeUndefined();
  });
});

describe("leaveRound", () => {
  it("一覧へ戻る手続きを呼ぶ", () => {
    // Given
    const tab = createTestRounds();

    // When
    tab.detail.leaveRound();

    // Then
    expect(tab.leaving.leaveRound).toHaveBeenCalledTimes(1);
  });

  it("一覧へ戻る手続きが投げたときは、その例外を伝える", () => {
    // Given
    const tab = createTestRounds();
    const failure = new Error("go failed");
    tab.leaving.leaveRound.mockImplementation(() => {
      throw failure;
    });

    // When
    const leave = () => tab.detail.leaveRound();

    // Then
    expect(leave).toThrow(failure);
  });
});

describe("savePreset", () => {
  const preset = {
    name: "練習用",
    format: "outdoor",
    bowType: "recurve",
    distances: [
      {
        positionKey: "a",
        distance: 70,
        totalEnds: 6,
        arrowsPerEnd: 6,
        targetFaceId: "face-1",
        isMarked: true,
      },
    ],
  };

  it.each([
    ["saved", { status: "saved" }],
    ["failed", { status: "failed", error: "保存できませんでした。" }],
  ] as const)(
    "保存の手続きへ同じプリセットを渡し、結果(%s)をそのまま返す",
    async (_name, result) => {
      // Given
      const tab = createTestRounds();
      tab.presetSaving.savePreset.mockResolvedValue(result);

      // When
      const saved = await tab.detail.savePreset(preset);

      // Then
      expect(tab.presetSaving.savePreset).toHaveBeenCalledWith(preset);
      expect(saved).toEqual(result);
    },
  );
});

describe("newId", () => {
  it("払い出しの約束の値を、呼ぶたびに返す", () => {
    // Given
    const tab = createTestRounds();

    // When
    const first = tab.detail.newId();
    const second = tab.detail.newId();

    // Then
    expect(first).toBe("event-1");
    expect(second).toBe("event-2");
  });
});

describe("newShotId", () => {
  const UuidV7 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const startMs = 0x0199_0000_0000;
  const timeOf = (id: string) =>
    Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
  const bytesFrom = (seed: number) => (length: number) =>
    Uint8Array.from({ length }, (_, i) => (seed + i) & 0xff);

  it("エンドに矢が無いときは、時計の現在時刻を先頭とする版7のUUIDを返す", () => {
    // Given
    const tab = createTestRounds({
      clockStart: startMs,
      randomBytes: bytesFrom(1),
    });

    // When
    const id = tab.detail.newShotId([]);

    // Then
    expect(id).toMatch(UuidV7);
    expect(timeOf(id)).toBe(startMs);
  });

  it("既にある矢のIDより、文字列として大きいIDを返す", () => {
    // Given
    const tab = createTestRounds({
      clockStart: startMs,
      randomBytes: bytesFrom(1),
    });
    const existing = "ffffffff-fff0-4fff-bfff-ffffffffffff";

    // When
    const id = tab.detail.newShotId([existing]);

    // Then
    expect(id).toMatch(UuidV7);
    expect(id > existing).toBe(true);
  });

  it("乱数は10バイトを払い出しの約束から取り、乱数が変わるとIDも変わる", () => {
    // Given
    const firstBytes = vi.fn(bytesFrom(1));
    const first = createTestRounds({
      clockStart: startMs,
      randomBytes: firstBytes,
    });
    const second = createTestRounds({
      clockStart: startMs,
      randomBytes: bytesFrom(50),
    });

    // When
    const firstId = first.detail.newShotId([]);
    const secondId = second.detail.newShotId([]);

    // Then
    expect(firstBytes.mock.calls).toEqual([[10]]);
    expect(firstId).not.toBe(secondId);
    expect(timeOf(firstId)).toBe(timeOf(secondId));
  });

  it("時計が遅れていて、既にある矢の時刻が時計より先でも、既にある矢より大きいIDを返す", () => {
    // Given
    const tab = createTestRounds({
      clockStart: startMs,
      randomBytes: bytesFrom(1),
    });
    const ahead = (startMs + 60_000).toString(16).padStart(12, "0");
    const existing = `${ahead.slice(0, 8)}-${ahead.slice(8)}-7000-8000-000000000000`;

    // When
    const id = tab.detail.newShotId([existing]);

    // Then
    expect(id > existing).toBe(true);
  });
});

describe("round(...)", () => {
  it("同じラウンドには同じ操作の入口を返す", () => {
    // Given
    const tab = createTestRounds();
    const handle = tab.detail.round("round-1");

    // When
    const again = tab.detail.round("round-1");

    // Then
    expect(again).toBe(handle);
  });
});
