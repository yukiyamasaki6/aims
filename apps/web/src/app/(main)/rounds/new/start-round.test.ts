import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_WAIT_MS } from "@/features/fetch-result/fetch-content";
import { roundOpHub } from "../[id]/round-op-hub";
import type { Preset } from "./preset-types";
import { startRound } from "./start-round";

// SupabaseのSDKは外部サービスとの境界のため、セッションの確認結果を任意に制御できるスタブで模す。
const supabase = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({ auth: { getSession: supabase.getSession } }),
}));

// 端末の操作の列(IndexedDBへの保存と常駐の送信)は別のテストで確かめるため、常駐のハブを境界としてモックする。
const hub = vi.hoisted(() => ({ acquire: vi.fn(), append: vi.fn() }));
vi.mock("../[id]/round-op-hub", () => ({
  roundOpHub: { acquire: hub.acquire },
}));

const signedInSession = { data: { session: { user: { id: "user-1" } } } };

// 呼び出し順に"id-1", "id-2", ...を返すIDの生成。
function createIdGenerator() {
  let count = 0;
  return () => {
    count += 1;
    return `id-${count}`;
  };
}

// UTCでは2026-09-29になる日時。
const now = () => new Date("2026-09-29T12:00:00.000Z");

const preset: Preset = {
  id: "preset-1",
  name: "プリセット",
  format: "indoor",
  bow_type: "compound",
  preset_distances: [
    {
      id: "d3",
      position_key: "c",
      distance: 30,
      is_marked: false,
      total_ends: 6,
      arrows_per_end: 6,
      target_face_id: "face-3",
      target_faces: null,
    },
    {
      id: "d1",
      position_key: "a",
      distance: 18,
      is_marked: true,
      total_ends: 10,
      arrows_per_end: 3,
      target_face_id: "face-1",
      target_faces: null,
    },
  ],
} as unknown as Preset;

function startWith(p: Preset | null, isMounted: () => boolean = () => true) {
  return startRound({
    preset: p,
    isMounted,
    generateId: createIdGenerator(),
    now,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase.getSession.mockResolvedValue(signedInSession);
  hub.acquire.mockReturnValue({ append: hub.append });
  hub.append.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startRound", () => {
  describe("開始できる場合", () => {
    it("プリセット未選択では、屋外・リカーブの距離無しの作成を操作の列へ追記する", async () => {
      // When
      const result = await startWith(null);

      // Then
      expect(hub.append).toHaveBeenCalledWith({
        type: "round.created",
        eventId: "id-1",
        roundId: "id-2",
        name: "",
        roundDate: "2026-09-29",
        format: "outdoor",
        bowType: "recurve",
        distances: [],
      });
      expect(result).toEqual({ status: "created", roundId: "id-2" });
    });

    it("プリセット選択時は、渡されたプリセットの距離をposition_key順に並べ新しいIDで追記する", async () => {
      // When
      const result = await startWith(preset);

      // Then
      expect(hub.append).toHaveBeenCalledWith({
        type: "round.created",
        eventId: "id-5",
        roundId: "id-6",
        name: "",
        roundDate: "2026-09-29",
        format: "indoor",
        bowType: "compound",
        distances: [
          {
            eventId: "id-1",
            id: "id-2",
            positionKey: "a",
            distance: 18,
            isMarked: true,
            totalEnds: 10,
            arrowsPerEnd: 3,
            targetFaceId: "face-1",
          },
          {
            eventId: "id-3",
            id: "id-4",
            positionKey: "c",
            distance: 30,
            isMarked: false,
            totalEnds: 6,
            arrowsPerEnd: 6,
            targetFaceId: "face-3",
          },
        ],
      });
      expect(result).toEqual({ status: "created", roundId: "id-6" });
    });

    it("作成したラウンドのストリームの操作の列へ追記する", async () => {
      // When
      await startWith(null);

      // Then
      expect(hub.acquire).toHaveBeenCalledTimes(1);
      expect(roundOpHub.acquire).toBe(hub.acquire);
    });

    it("端末への保存の完了を待ってから結果を返す", async () => {
      // Given: 保存の完了を保留にする
      let finish: () => void = () => {};
      hub.append.mockReturnValue(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      let settled = false;

      // When
      const pending = startWith(null).then((r) => {
        settled = true;
        return r;
      });
      await vi.waitFor(() => expect(hub.append).toHaveBeenCalled());
      await Promise.resolve();

      // Then: 保存が終わるまで返らず、終わると返る
      expect(settled).toBe(false);
      finish();
      expect(await pending).toEqual({ status: "created", roundId: "id-2" });
    });

    it("セッションの確認が通信失敗で不明でも、開始する", async () => {
      // Given
      supabase.getSession.mockResolvedValue({
        data: { session: null },
        error: new AuthRetryableFetchError("Failed to fetch", 0),
      });

      // When
      const result = await startWith(null);

      // Then
      expect(result).toEqual({ status: "created", roundId: "id-2" });
    });

    it("セッションの確認が例外で失敗しても、開始する", async () => {
      // Given
      supabase.getSession.mockRejectedValue(new Error("network down"));

      // When
      const result = await startWith(null);

      // Then
      expect(result).toEqual({ status: "created", roundId: "id-2" });
    });

    it("セッションの確認が上限時間を過ぎても終わらない場合、時間切れとして開始する", async () => {
      // Given: 確認が終わらない
      vi.useFakeTimers();
      supabase.getSession.mockReturnValue(new Promise(() => {}));

      // When
      const pending = startWith(null);
      await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS);

      // Then
      expect(await pending).toEqual({ status: "created", roundId: "id-2" });
    });
  });

  describe("開始できない場合", () => {
    it("サインインしていない場合、操作の列へ追記せずサインインを求めるエラーを返す", async () => {
      // Given
      supabase.getSession.mockResolvedValue({ data: { session: null } });

      // When
      const result = await startWith(null);

      // Then
      expect(result).toEqual({
        status: "failed",
        error: "サインインが必要です。",
      });
      expect(hub.append).not.toHaveBeenCalled();
    });
  });

  describe("完了を待つ間にアンマウントされた場合", () => {
    it("セッションの確認中にアンマウントされると、操作の列へ追記せず結果を破棄する", async () => {
      // Given
      let mounted = true;

      supabase.getSession.mockImplementation(async () => {
        mounted = false;
        return signedInSession;
      });

      // When
      const result = await startWith(null, () => mounted);

      // Then
      expect(result).toEqual({ status: "discarded" });
      expect(hub.append).not.toHaveBeenCalled();
    });
  });
});
