import { describe, expect, it, vi } from "vitest";
import type { SessionReader } from "@/features/auth";
import { createFakeSessionReader } from "@/features/auth/application/session-reader-test-helpers";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakePageNavigation } from "@/lib/page-navigation/fake-page-navigation-test-helpers";
import { FALLBACK_WAIT_MS } from "../domain/fetch-wait";
import type { Preset } from "../domain/preset";
import { roundPath } from "../domain/round-routes";
import { roundCreatedDraftOf } from "../domain/round-start";
import { roundStreamId } from "../domain/sync-events";
import { createFakeUniqueIds } from "./fake-unique-ids-test-helpers";
import { createRoundStart } from "./round-start";

type Reading = Awaited<ReturnType<SessionReader["readSession"]>>;

// UTCでは2026-09-29になる時刻。
const NOW = Date.parse("2026-09-29T12:00:00.000Z");

const preset: Preset = {
  id: "preset-1",
  name: "プリセット",
  format: "indoor",
  bow_type: "compound",
  preset_distances: [
    {
      id: "d2",
      position_key: "1-2",
      distance: 25,
      is_marked: false,
      total_ends: 10,
      arrows_per_end: 3,
      target_face_id: "face-2",
      target_faces: null,
    },
    {
      id: "d1",
      position_key: "1-1",
      distance: 18,
      is_marked: true,
      total_ends: 20,
      arrows_per_end: 3,
      target_face_id: "face-1",
      target_faces: null,
    },
  ],
};

// 呼び出しの順序(保存の完了、遷移)を、1つの列に積んで観測する。
function setup(
  options: {
    readings?: Reading[];
    read?: SessionReader["readSession"];
    holdAppend?: boolean;
    go?: (path: string) => void;
  } = {},
) {
  const calls: string[] = [];
  const clock = createManualClock(NOW);
  const { sessionReader } = createFakeSessionReader(
    options.read
      ? [options.read]
      : [
          ...(options.readings ?? []),
          { status: "authenticated", userId: "user-1" },
        ],
  );
  let finishAppend: () => void = () => {};
  const append = vi.fn(async (_streamId: string, _operation: unknown) => {
    if (options.holdAppend) {
      await new Promise<void>((resolve) => {
        finishAppend = resolve;
      });
    }
    calls.push("append:done");
  });
  const { pageNavigation, go } = createFakePageNavigation({
    log: calls,
    onGo: options.go,
  });
  const { ids, issued } = createFakeUniqueIds();
  const roundStart = createRoundStart({
    hub: { append },
    sessionReader,
    ids,
    clock,
    pageNavigation,
  });
  return {
    roundStart,
    clock,
    append,
    go,
    calls,
    issued,
    finishAppend: () => finishAppend(),
  };
}

// 追記した作成の操作のラウンドID。
function appendedRoundId(append: { mock: { calls: unknown[][] } }): string {
  return (append.mock.calls[0][1] as { roundId: string }).roundId;
}

describe("createRoundStart", () => {
  describe("開始できる場合", () => {
    it("プリセット未選択では、作成をそのラウンドの列へ1回だけ追記し、払い出されたIDを使ってcreatedを返す", async () => {
      // Given
      const { roundStart, append } = setup();

      // When
      const result = await roundStart.startRound(null, () => true);

      // Then
      expect(append).toHaveBeenCalledTimes(1);
      const [streamId, operation] = append.mock.calls[0] as [
        string,
        { type: string; roundId: string; eventId: string },
      ];
      expect(operation.type).toBe("round.created");
      expect(streamId).toBe(roundStreamId(operation.roundId));
      expect(result).toEqual({ status: "created", roundId: operation.roundId });
    });

    it("操作・ラウンド・各距離のIDは、全て新しい互いに異なる値で振られ、IDの数が距離の数と対応する", async () => {
      // Given
      const { roundStart, append, issued } = setup();

      // When
      await roundStart.startRound(preset, () => true);

      // Then
      const operation = append.mock.calls[0][1] as {
        eventId: string;
        roundId: string;
        distances: { eventId: string; id: string }[];
      };
      const used = [
        operation.eventId,
        operation.roundId,
        ...operation.distances.flatMap((d) => [d.eventId, d.id]),
      ];
      expect(operation.distances).toHaveLength(2);
      expect(used).toHaveLength(6);
      expect(new Set(used).size).toBe(6);
      expect(new Set(used)).toEqual(new Set(issued()));
    });

    it("プリセット選択時の追記は、下書きにIDを足しただけで、内容を変えない", async () => {
      // Given
      const { roundStart, append } = setup();

      // When
      await roundStart.startRound(preset, () => true);

      // Then
      const operation = append.mock.calls[0][1] as {
        eventId: string;
        roundId: string;
        distances: { eventId: string; id: string }[];
      };
      const {
        eventId: _eventId,
        roundId: _roundId,
        distances,
        ...rest
      } = operation;
      const draft = roundCreatedDraftOf(preset, NOW);
      expect(rest).toEqual({ ...draft, distances: undefined });
      expect(
        distances.map(({ eventId: _e, id: _i, ...content }) => content),
      ).toEqual(draft.distances);
    });

    it("プリセットが無いとき(距離0件)、IDは操作とラウンドの2個だけ払い出される", async () => {
      // Given
      const { roundStart, issued } = setup();

      // When
      await roundStart.startRound(null, () => true);

      // Then
      expect(issued()).toHaveLength(2);
    });

    it("実施日は、手続きが読んだ時計の時刻から求める", async () => {
      // Given
      const { roundStart, append, clock } = setup();
      clock.advance(24 * 60 * 60 * 1000);

      // When
      await roundStart.startRound(null, () => true);

      // Then
      const operation = append.mock.calls[0][1] as { roundDate: string };
      expect(operation.roundDate).toBe(
        roundCreatedDraftOf(null, clock.now()).roundDate,
      );
    });

    it("端末への保存の完了を待ってから、詳細の画面へ進み、その後に結果を返す", async () => {
      // Given
      const { roundStart, append, go, calls, finishAppend } = setup({
        holdAppend: true,
      });
      let settled = false;

      // When
      const pending = roundStart
        .startRound(null, () => true)
        .then((result) => {
          settled = true;
          return result;
        });
      await vi.waitFor(() => expect(append).toHaveBeenCalled());
      await Promise.resolve();
      const stateBeforeFinish = { settled, navigated: go.mock.calls.length };
      finishAppend();
      const result = await pending;

      // Then
      expect(stateBeforeFinish).toEqual({ settled: false, navigated: 0 });
      expect(calls).toEqual([
        "append:done",
        `go:${roundPath(appendedRoundId(append))}`,
      ]);
      expect(result).toEqual({
        status: "created",
        roundId: appendedRoundId(append),
      });
    });

    it("認証が不明でも、開始する", async () => {
      // Given
      const { roundStart, append, go } = setup({
        readings: [{ status: "unknown" }],
      });

      // When
      const result = await roundStart.startRound(null, () => true);

      // Then
      expect(result).toEqual({
        status: "created",
        roundId: appendedRoundId(append),
      });
      expect(append).toHaveBeenCalledTimes(1);
      expect(go).toHaveBeenCalledTimes(1);
    });

    it("認証の確認が上限時間を過ぎても終わらないときは、時間切れとして開始する", async () => {
      // Given
      const { roundStart, append, clock } = setup({
        read: () => new Promise(() => {}),
      });

      // When
      const pending = roundStart.startRound(null, () => true);
      await clock.advanceAsync(FALLBACK_WAIT_MS - 1);
      const appendedBeforeLimit = append.mock.calls.length;
      await clock.advanceAsync(1);
      const result = await pending;

      // Then
      expect(appendedBeforeLimit).toBe(0);
      expect(append).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        status: "created",
        roundId: appendedRoundId(append),
      });
    });
  });

  describe("開始できない場合", () => {
    it("サインインしていないとき、追記も遷移もせず、読み取りの文言でfailedを返す", async () => {
      // Given
      const { roundStart, append, go } = setup({
        readings: [{ status: "unauthenticated" }],
      });

      // When
      const result = await roundStart.startRound(null, () => true);

      // Then
      expect(result).toEqual({ status: "failed", error: "unauthenticated" });
      expect(append).not.toHaveBeenCalled();
      expect(go).not.toHaveBeenCalled();
    });

    it("同じ読み手で続けて開始し、2回目に未認証になると、2回目は追記せずfailedを返す", async () => {
      // Given
      const { roundStart, append } = setup({
        readings: [
          { status: "authenticated", userId: "user-1" },
          { status: "unauthenticated" },
        ],
      });
      const first = await roundStart.startRound(null, () => true);

      // When
      const second = await roundStart.startRound(null, () => true);

      // Then
      expect(first.status).toBe("created");
      expect(second).toEqual({ status: "failed", error: "unauthenticated" });
      expect(append).toHaveBeenCalledTimes(1);
    });

    it("認証の確認の間にisCurrentが偽になると、何も積まず遷移せずdiscardedを返す", async () => {
      // Given
      let current = true;
      const { roundStart, append, go } = setup({
        read: async () => {
          current = false;
          return { status: "authenticated", userId: "user-1" };
        },
      });

      // When
      const result = await roundStart.startRound(null, () => current);

      // Then
      expect(result).toEqual({ status: "discarded" });
      expect(append).not.toHaveBeenCalled();
      expect(go).not.toHaveBeenCalled();
    });

    it("未認証の確認の間に破棄されたときは、failedではなくdiscardedを返す", async () => {
      // Given
      let current = true;
      const { roundStart } = setup({
        read: async () => {
          current = false;
          return { status: "unauthenticated" };
        },
      });

      // When
      const result = await roundStart.startRound(null, () => current);

      // Then
      expect(result).toEqual({ status: "discarded" });
    });

    it("遷移が投げたとき、追記は済んでおり、開始はその例外で拒否され、createdもfailedも返らない", async () => {
      // Given
      const failure = new Error("rejected path");
      const { roundStart, append, go } = setup({
        go: () => {
          throw failure;
        },
      });

      // When
      const outcome = roundStart.startRound(null, () => true);

      // Then
      await expect(outcome).rejects.toBe(failure);
      expect(append).toHaveBeenCalledTimes(1);
      expect(go).toHaveBeenCalledTimes(1);
    });
  });
});
