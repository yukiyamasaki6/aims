import { describe, expect, it, vi } from "vitest";
import {
  roundUpdated,
  shotCleared,
  shotRecorded,
} from "../domain/round-op-test-helpers";
import { roundStreamId } from "../domain/sync-events";
import { createSenderRig, flush } from "./op-sender-test-helpers";
import type { SendOutcome } from "./operation-sending";
import {
  appliedOutcome,
  createMemoryRoundStore,
} from "./round-record-test-helpers";

const STREAM = roundStreamId("round-1");

// 送信の規則(順序、衝突、リトライ、保留)が検証対象で、矢の点数は問わないため、矢は識別子と位置だけで表す。
// 同じエンドの矢は互いに衝突し、別のエンドの矢は衝突しない。
const shot = (id: string, end = 1, distance = "d-1") =>
  shotRecorded({
    eventId: id,
    shotId: id,
    distanceId: distance,
    endNumber: end,
  });
const clear = (id: string, shotId: string, end = 1, distance = "d-1") =>
  shotCleared({ eventId: id, shotId, distanceId: distance, endNumber: end });

const rpcFailure = (code?: string): SendOutcome => ({
  ok: false,
  failure: { cause: "rpc", code },
});

type Rig = ReturnType<typeof createSenderRig>;
type RigOptions = Parameters<typeof createSenderRig>[0];

// 起動して、保存の読み込みを終えた送信器。
async function started(options: RigOptions = {}): Promise<Rig> {
  const rig = createSenderRig(options);
  await rig.hub.ready();
  rig.sender.start();
  await flush();
  return rig;
}

const sentIds = (rig: Rig) => rig.sent.map((flight) => flight.eventIds);
const itemIds = (rig: Rig) =>
  rig.hub.record(STREAM).items.map((item) => item.eventId);

async function respond(rig: Rig, index: number, outcome: SendOutcome) {
  rig.sent[index].resolve(outcome);
  await flush();
}

describe("送信の順序", () => {
  it("追記は保存の完了前には送らず、完了後に送る", async () => {
    // Given
    const rig = await started();
    const saving = Promise.withResolvers<void>();
    const save = rig.store.append.bind(rig.store);
    vi.spyOn(rig.store, "append").mockImplementationOnce(async (...args) => {
      await saving.promise;
      return save(...args);
    });

    // When
    void rig.hub.append(STREAM, shot("a"));
    await flush();
    const beforeSave = rig.sent.length;
    saving.resolve();
    await flush();

    // Then
    expect(beforeSave).toBe(0);
    expect(sentIds(rig)).toEqual([["a"]]);
  });

  it("成功すると確定したrevisionを記録へ書き、操作は列に残す", async () => {
    // Given
    const rig = await started();
    await rig.hub.append(STREAM, shot("a"));
    await flush();

    // When
    await respond(rig, 0, appliedOutcome(1, 7));

    // Then
    expect(rig.hub.record(STREAM).items[0]).toMatchObject({
      eventId: "a",
      ackedRevision: 7,
    });
    expect(rig.sent).toHaveLength(1);
  });

  it("応答待ちの間に積んだ操作は、応答の後に残りを1本の要求にまとめて送る", async () => {
    // Given
    const rig = await started();
    await rig.hub.append(STREAM, shot("a", 1));
    await flush();

    // When
    await rig.hub.append(STREAM, shot("b", 2));
    await rig.hub.append(STREAM, shot("c", 3));
    await rig.hub.append(STREAM, shot("d", 4));
    await flush();
    const whileWaiting = sentIds(rig);
    await respond(rig, 0, appliedOutcome(1));

    // Then
    expect(whileWaiting).toEqual([["a"]]);
    expect(sentIds(rig)).toEqual([["a"], ["b", "c", "d"]]);
  });

  it("同じ矢の記録と取り消しは、前の確定を待って順に送る", async () => {
    // Given
    const rig = await started();
    await rig.hub.append(STREAM, shot("rec"));
    await rig.hub.append(STREAM, clear("clr", "rec"));
    await flush();
    const beforeAck = sentIds(rig);

    // When
    await respond(rig, 0, appliedOutcome(1));

    // Then
    expect(beforeAck).toEqual([["rec"]]);
    expect(sentIds(rig)).toEqual([["rec"], ["clr"]]);
  });

  it("異なる距離の要求は、前の応答を待たずに同時に送る", async () => {
    // Given
    const rig = await started();

    // When
    await rig.hub.append(STREAM, shot("a", 1, "d-1"));
    await rig.hub.append(STREAM, shot("b", 1, "d-2"));
    await flush();

    // Then
    expect(sentIds(rig)).toEqual([["a"], ["b"]]);
  });

  it("送る前に、サインインの状態をその時点で読む(送るたびに読み直す)", async () => {
    // Given
    const rig = await started();
    await rig.hub.append(STREAM, shot("a", 1));
    await flush();
    await respond(rig, 0, appliedOutcome(1));
    rig.signIn.reading = { status: "unauthenticated" };

    // When
    await rig.hub.append(STREAM, shot("b", 2));
    await flush();

    // Then
    expect(rig.signIn.read).toHaveBeenCalledTimes(2);
    expect(sentIds(rig)).toEqual([["a"]]);
  });

  it("始める前に操作が追記されても、投げずに待ち、始めると送る", async () => {
    // Given
    const rig = createSenderRig();
    await rig.hub.ready();
    await rig.hub.append(STREAM, shot("a"));
    await flush();
    const beforeStart = rig.sent.length;

    // When
    rig.sender.start();
    await flush();

    // Then
    expect(beforeStart).toBe(0);
    expect(sentIds(rig)).toEqual([["a"]]);
  });

  it("2回目のstartは何もしない", async () => {
    // Given
    const rig = await started();
    await rig.hub.append(STREAM, shot("a"));
    await flush();

    // When
    rig.sender.start();
    await flush();

    // Then
    expect(rig.sent).toHaveLength(1);
  });
});

describe("送る候補と衝突の判定", () => {
  it("確定済みの操作は送らず、確定していない操作だけを送る", async () => {
    // Given
    const rig = createSenderRig();
    await rig.hub.ready();
    await rig.hub.append(STREAM, roundUpdated({ eventId: "confirmed" }));
    rig.hub.applySendResults(
      STREAM,
      ["confirmed"],
      [
        {
          revision: 1,
          applied: true,
          appliedFields: null,
          hasRejectedFields: false,
        },
      ],
    );
    await rig.hub.append(STREAM, shotRecorded({ eventId: "shot" }));

    // When
    rig.sender.start();
    await flush();

    // Then
    expect(sentIds(rig)).toEqual([["shot"]]);
  });

  it("同じ矢の記録と取り消しは衝突として、記録の送信が終わるまで取り消しを送らない", async () => {
    // Given
    const rig = await started();
    await rig.hub.append(STREAM, shotRecorded({ eventId: "rec" }));
    await rig.hub.append(STREAM, shotCleared({ eventId: "clr" }));
    await flush();
    const whileSending = sentIds(rig);

    // When
    await respond(rig, 0, appliedOutcome(1));

    // Then
    expect(whileSending).toEqual([["rec"]]);
    expect(sentIds(rig)).toEqual([["rec"], ["clr"]]);
  });

  it("記録が変わった後に追記した操作も、送信中の操作との衝突を判定する", async () => {
    // Given
    const rig = await started();
    await rig.hub.append(STREAM, shotRecorded({ eventId: "rec" }));
    await rig.hub.append(STREAM, shotCleared({ eventId: "clr" }));
    await flush();

    // When
    await rig.hub.append(STREAM, shotCleared({ eventId: "clr2" }));
    await flush();

    // Then
    expect(sentIds(rig)).toEqual([["rec"]]);
  });
});

describe("記録が返す平らな失敗", () => {
  type Report = Awaited<ReturnType<Rig["sending"]["send"]>>;
  type Row = [string, Report | Error, "破棄" | "再送"];
  const rows: Row[] = [
    [
      "rpc 403 PT403",
      { ok: false, failure: { cause: "rpc", code: "PT403" } },
      "破棄",
    ],
    [
      "rpc 422 PT422",
      { ok: false, failure: { cause: "rpc", code: "PT422" } },
      "破棄",
    ],
    [
      "rpc 500 XX000",
      { ok: false, failure: { cause: "rpc", code: "XX000" } },
      "再送",
    ],
    [
      "rpc 404 PGRST202",
      { ok: false, failure: { cause: "rpc", code: "PGRST202" } },
      "再送",
    ],
    [
      "rpc 状態もコードも無い",
      { ok: false, failure: { cause: "rpc" } },
      "再送",
    ],
    ["exception", { ok: false, failure: { cause: "exception" } }, "再送"],
    ["sendが例外を投げる", new Error("boom"), "再送"],
  ];

  it.each(rows)(
    "記録の送信が%sを返すと、操作を%sする",
    async (_name, returned, expected) => {
      // Given
      const rig = await started();
      const send = vi
        .spyOn(rig.sending, "send")
        .mockImplementation(async () => {
          if (returned instanceof Error) throw returned;
          return returned;
        });
      await rig.hub.append(STREAM, shot("a", 1));
      await flush();
      const afterFirst = send.mock.calls.length;

      // When
      await rig.clock.advanceAsync(2999);
      const beforeDelay = send.mock.calls.length;
      await rig.clock.advanceAsync(1);
      await flush();

      // Then
      expect(afterFirst).toBe(1);
      expect(beforeDelay).toBe(1);
      if (expected === "破棄") {
        expect(send).toHaveBeenCalledTimes(1);
        expect(itemIds(rig)).toEqual([]);
      } else {
        expect(send).toHaveBeenCalledTimes(2);
        expect(itemIds(rig)).toEqual(["a"]);
      }
    },
  );
});

describe("失敗の扱い", () => {
  it("一時的な失敗の後のリトライ待機中は、衝突する後続を送らず、衝突しない操作は送る", async () => {
    // Given
    const rig = await started();
    await rig.hub.append(STREAM, shot("a", 1));
    await flush();
    await rig.hub.append(STREAM, shot("same-end", 1));
    await rig.hub.append(STREAM, shot("other-end", 2));

    // When
    await respond(rig, 0, rpcFailure());

    // Then
    expect(sentIds(rig)).toEqual([["a"], ["other-end"]]);
  });

  it("待機時間が経つと同じ要求を再送し、確定すると止めていた衝突する後続を送る", async () => {
    // Given
    const rig = await started();
    await rig.hub.append(STREAM, shot("a", 1));
    await flush();
    await rig.hub.append(STREAM, shot("follower", 1));
    await respond(rig, 0, rpcFailure());
    await rig.clock.advanceAsync(2999);
    const beforeDelay = rig.sent.length;

    // When
    await rig.clock.advanceAsync(1);
    const resent = sentIds(rig);
    await respond(rig, 1, appliedOutcome(1));

    // Then
    expect(beforeDelay).toBe(1);
    expect(resent).toEqual([["a"], ["a"]]);
    expect(sentIds(rig)).toEqual([["a"], ["a"], ["follower"]]);
  });

  it("失敗が続くと待機時間を3秒、6秒と伸ばして再送し、その間も衝突する後続は止めたまま別の対象は送る", async () => {
    // Given
    const rig = await started();
    await rig.hub.append(STREAM, shot("a", 1));
    await flush();
    await rig.hub.append(STREAM, shot("follower", 1));
    await respond(rig, 0, rpcFailure());
    await rig.clock.advanceAsync(3000);
    await respond(rig, 1, rpcFailure());

    // When
    await rig.clock.advanceAsync(5999);
    const beforeSecond = rig.sent.length;
    await rig.clock.advanceAsync(1);

    // Then
    expect(beforeSecond).toBe(2);
    expect(sentIds(rig)).toEqual([["a"], ["a"], ["a"]]);
  });

  it("送信が例外を投げたら、再試行する失敗として扱う", async () => {
    // Given
    const rig = await started();
    vi.mocked(rig.transport.send).mockRejectedValueOnce(
      new Error("接続が切れた"),
    );
    await rig.hub.append(STREAM, shot("a"));
    await flush();

    // When
    await rig.clock.advanceAsync(3000);

    // Then
    expect(sentIds(rig)).toEqual([["a"]]);
    expect(itemIds(rig)).toEqual(["a"]);
  });

  it("認可・契約で拒否された操作(PT403)は、破棄して列から外し、後続を止めない", async () => {
    // Given
    const rig = await started();
    await rig.hub.append(STREAM, shot("rejected", 1));
    await flush();
    await rig.hub.append(STREAM, shot("follower", 1));

    // When
    await respond(rig, 0, rpcFailure("PT403"));

    // Then
    expect(itemIds(rig)).toEqual(["follower"]);
    expect(sentIds(rig)).toEqual([["rejected"], ["follower"]]);
  });

  it("PGRST202や4xxなどのPT403・PT422以外の失敗は、破棄せず再試行する", async () => {
    // Given
    const rig = await started();
    await rig.hub.append(STREAM, shot("a"));
    await flush();

    // When
    await respond(rig, 0, rpcFailure("PGRST202"));
    await rig.clock.advanceAsync(3000);

    // Then
    expect(itemIds(rig)).toEqual(["a"]);
    expect(sentIds(rig)).toEqual([["a"], ["a"]]);
  });

  it("複数件の要求がPT422で拒否されたら、単独に切り分け、拒否された1件だけを破棄する", async () => {
    // Given
    const rig = await started();
    await rig.hub.append(STREAM, shot("first", 1));
    await flush();
    await rig.hub.append(STREAM, shot("b", 2));
    await rig.hub.append(STREAM, shot("c", 3));
    await rig.hub.append(STREAM, shot("d", 4));
    await respond(rig, 0, appliedOutcome(1));

    // When
    await respond(rig, 1, rpcFailure("PT422"));
    await respond(rig, 2, rpcFailure("PT422"));
    await respond(rig, 3, appliedOutcome(1));
    await respond(rig, 4, appliedOutcome(1));

    // Then
    expect(sentIds(rig)).toEqual([
      ["first"],
      ["b", "c", "d"],
      ["b"],
      ["c"],
      ["d"],
    ]);
    expect(itemIds(rig)).toEqual(["first", "c", "d"]);
  });

  it("ある距離の破棄は、別の距離の確定に及ばない", async () => {
    // Given
    const rig = await started();
    await rig.hub.append(STREAM, shot("a", 1, "d-1"));
    await rig.hub.append(STREAM, shot("b", 1, "d-2"));
    await flush();

    // When
    await respond(rig, 0, rpcFailure("PT403"));
    await respond(rig, 1, appliedOutcome(1, 3));

    // Then
    expect(itemIds(rig)).toEqual(["b"]);
    expect(rig.hub.record(STREAM).items[0].ackedRevision).toBe(3);
  });

  it("効かなかった操作は列から外し、再取得が要る印を付けて、後続を送る", async () => {
    // Given
    const rig = await started();
    await rig.hub.append(STREAM, shot("a", 1));
    await flush();
    await rig.hub.append(STREAM, shot("follower", 1));

    // When
    await respond(rig, 0, {
      ok: true,
      results: [
        {
          revision: null,
          applied: false,
          appliedFields: null,
          hasRejectedFields: false,
        },
      ],
    });

    // Then
    expect(itemIds(rig)).toEqual(["follower"]);
    expect(rig.hub.divergedStreams().has(STREAM)).toBe(true);
    expect(sentIds(rig)).toEqual([["a"], ["follower"]]);
  });
});

describe("サインインの状態", () => {
  it("未認証なら送らずに保留し、衝突する後続も止める。サインインし直して再開すると送る", async () => {
    // Given
    const rig = await started({
      reading: { status: "unauthenticated" },
    });
    await rig.hub.append(STREAM, shot("a", 1));
    await rig.hub.append(STREAM, shot("follower", 1));
    await flush();
    const whileHeld = rig.sent.length;

    // When
    rig.signIn.reading = { status: "authenticated", userId: "user-1" };
    rig.sender.resumeHeld();
    await flush();

    // Then
    expect(whileHeld).toBe(0);
    expect(sentIds(rig)).toEqual([["a", "follower"]]);
  });

  it("サインインの状態が不明(通信失敗)なら送らずに再試行し、確認できるようになると送る", async () => {
    // Given
    const rig = await started({
      reading: { status: "unknown" },
    });
    await rig.hub.append(STREAM, shot("a"));
    await flush();
    rig.signIn.reading = { status: "authenticated", userId: "user-1" };

    // When
    await rig.clock.advanceAsync(3000);

    // Then
    expect(sentIds(rig)).toEqual([["a"]]);
  });

  it("サインインしている利用者が列の利用者と違えば、未認証として保留し、送らない", async () => {
    // Given
    const rig = await started({
      reading: { status: "authenticated", userId: "user-2" },
    });

    // When
    await rig.hub.append(STREAM, shot("a"));
    await flush();

    // Then
    expect(rig.sent).toHaveLength(0);
  });

  it("列の利用者がnull(unowned)なら、サインインしている利用者で送る", async () => {
    // Given
    const rig = await started({ userId: null });

    // When
    await rig.hub.append(STREAM, shot("a"));
    await flush();

    // Then
    expect(sentIds(rig)).toEqual([["a"]]);
  });
});

describe("保存の読み込みの待ち", () => {
  it("別のタブが保存していた新しい列の操作も、起動したタブが保存から読んで送る", async () => {
    // Given
    const store = createMemoryRoundStore();
    const writer = createSenderRig({ shared: { store } });
    await writer.hub.ready();
    await writer.hub.append(STREAM, shot("a"));
    const starting = createSenderRig({ shared: { store } });

    // When
    await starting.hub.ready();
    starting.sender.start();
    await flush();

    // Then
    expect(sentIds(starting)).toEqual([["a"]]);
  });

  it("読み込みが終わるまで、既知の列の保存済みの操作を送らず、終わると列の順に送る", async () => {
    // Given
    const rig = createSenderRig();
    await rig.hub.ready();
    await rig.hub.append(STREAM, shot("saved"));
    const reload = Promise.withResolvers<void>();
    vi.spyOn(rig.hub, "ready").mockReturnValueOnce(reload.promise);
    rig.sender.start();
    await flush();

    // When
    rig.connectivity.goOnline();
    await rig.hub.append(STREAM, shot("later", 3));
    await flush();
    const whileReloading = sentIds(rig).flat();
    reload.resolve();
    await flush();

    // Then
    expect(whileReloading).toEqual([]);
    expect(sentIds(rig).flat()).toEqual(["saved", "later"]);
  });
});

describe("通信の可否", () => {
  it("オフラインの間は要求を始めず、onlineの知らせで送る", async () => {
    // Given
    const rig = await started({ offline: true });
    await rig.hub.append(STREAM, shot("a"));
    await flush();
    const whileOffline = rig.sent.length;

    // When
    rig.connectivity.goOnline();
    await flush();

    // Then
    expect(whileOffline).toBe(0);
    expect(sentIds(rig)).toEqual([["a"]]);
  });

  it("オンラインへ戻ると、待機中の再送を待たずに再開する", async () => {
    // Given
    const rig = await started();
    await rig.hub.append(STREAM, shot("a"));
    await flush();
    await respond(rig, 0, rpcFailure());
    await rig.clock.advanceAsync(1000);

    // When
    rig.connectivity.goOnline();
    await flush();

    // Then
    expect(sentIds(rig)).toEqual([["a"], ["a"]]);
  });

  it("通信の復帰の購読は、起動で1つ増える", () => {
    // Given
    const rig = createSenderRig();
    const initial = rig.connectivity.subscribers().online;

    // When
    rig.sender.start();
    const started = rig.connectivity.subscribers().online;

    // Then
    expect([initial, started]).toEqual([0, 1]);
  });
});

describe("名前だけの更新の操作", () => {
  it("ラウンドの更新は1件ずつ、前の確定を待って送る", async () => {
    // Given
    const rig = await started();
    await rig.hub.append(STREAM, roundUpdated({ eventId: "u1" }));
    await rig.hub.append(STREAM, roundUpdated({ eventId: "u2" }));
    await flush();

    // When
    await respond(rig, 0, appliedOutcome(1));

    // Then
    expect(sentIds(rig)).toEqual([["u1"], ["u2"]]);
  });
});
