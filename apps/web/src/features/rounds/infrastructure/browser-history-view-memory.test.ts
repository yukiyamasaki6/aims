import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HISTORY_VIEW_STATE,
  type HistoryViewState,
} from "../domain/history-view-state";
import {
  createBrowserHistoryViewMemory,
  eraseHistoryViewMemory,
} from "./browser-history-view-memory";

const saved: HistoryViewState = {
  input: {
    unit: "distance",
    dateDirection: "asc",
    scoreDirection: "desc",
    format: "indoor",
    bowType: "compound",
    dateFrom: "2026-05-01",
    dateTo: "2026-05-31",
    scoreMin: 0,
    scoreMax: 600,
    distanceScoreMin: 20,
    distanceScoreMax: 80,
    distances: [
      {
        distance: 50,
        arrowsPerEnd: 6,
        targetFaceId: "a1000000-0000-0000-0000-000000000001",
      },
      {
        distance: 30,
        arrowsPerEnd: null,
        targetFaceId: null,
      },
    ],
    distanceRow: { distance: 30, arrowsPerEnd: 3, targetFaceId: null },
  },
};

// 端末に最後にサインインした利用者。テストが差し替える。
let signedInUser: string | null;
const identityReader = { read: () => signedInUser };

beforeEach(() => {
  signedInUser = "user-1";
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createBrowserHistoryViewMemory", () => {
  describe("read", () => {
    it("同じ利用者が書いた状態を返す", () => {
      // Given
      const memory = createBrowserHistoryViewMemory(identityReader);
      memory.write(saved);

      // When
      const state = createBrowserHistoryViewMemory(identityReader).read();

      // Then
      expect(state).toEqual(saved);
    });

    it("単位ごとの得点の範囲、ラウンド構成、距離の指定を持つ状態を書いて読むと、使わない単位の値も含めて全て復元する", () => {
      // Given
      const state: HistoryViewState = {
        input: { ...saved.input, unit: "round" },
      };
      createBrowserHistoryViewMemory(identityReader).write(state);

      // When
      const { input } = createBrowserHistoryViewMemory(identityReader).read();

      // Then
      expect([input.scoreMin, input.scoreMax]).toEqual([0, 600]);
      expect([input.distanceScoreMin, input.distanceScoreMax]).toEqual([
        20, 80,
      ]);
      expect(input.distances).toEqual(saved.input.distances);
      expect(input.distanceRow).toEqual(saved.input.distanceRow);
    });

    it.each(["round", "distance"])(
      "距離単位の範囲の項目が無い保存値(単位が%s)は、scoreMin・scoreMaxをラウンド単位の範囲として読み、距離単位の範囲は指定なしにする",
      (unit) => {
        // Given
        const {
          distanceScoreMin: _min,
          distanceScoreMax: _max,
          ...withoutDistanceRange
        } = saved.input;
        window.sessionStorage.setItem(
          "aims:history-view",
          JSON.stringify({
            userId: "user-1",
            state: {
              input: {
                ...withoutDistanceRange,
                unit,
                scoreMin: 100,
                scoreMax: 500,
              },
            },
          }),
        );

        // When
        const { input } = createBrowserHistoryViewMemory(identityReader).read();

        // Then
        expect([input.scoreMin, input.scoreMax]).toEqual([100, 500]);
        expect([input.distanceScoreMin, input.distanceScoreMax]).toEqual([
          null,
          null,
        ]);
      },
    );

    it("型に無い項目だけの保存値(condition・sortKey・unit・distanceRow・filterOpen・distanceRowInput)は、読み替えず、既定の状態で返す", () => {
      // Given
      // 型に無い項目を読み替えない規則の全組はdomainで確かめる。ここでは、読み出しがその規則を通ることを確かめる。
      window.sessionStorage.setItem(
        "aims:history-view",
        JSON.stringify({
          userId: "user-1",
          state: {
            condition: {
              unit: "distance",
              sortKey: "score",
              sortDirection: "asc",
              format: "indoor",
            },
            filterOpen: false,
            distanceRowInput: [
              { distance: "50", arrowsPerEnd: "", targetFaceId: null },
            ],
          },
        }),
      );
      const memory = createBrowserHistoryViewMemory(identityReader);

      // When
      const state = memory.read();

      // Then
      expect(state).toEqual(DEFAULT_HISTORY_VIEW_STATE);
    });

    it("保存値に型に無い項目の矢の総数(totalArrows)が入っていても、他の項目は保ち、総数だけを捨てて読み、再保存すると鍵が消える", () => {
      // Given
      window.sessionStorage.setItem(
        "aims:history-view",
        JSON.stringify({
          userId: "user-1",
          state: {
            input: {
              ...saved.input,
              distances: [
                {
                  distance: 50,
                  arrowsPerEnd: 6,
                  totalArrows: 36,
                  targetFaceId: null,
                },
              ],
              distanceRow: {
                distance: 30,
                arrowsPerEnd: 3,
                totalArrows: 36,
                targetFaceId: null,
              },
            },
          },
        }),
      );
      const memory = createBrowserHistoryViewMemory(identityReader);

      // When
      const state = memory.read();
      memory.write(state);

      // Then
      expect(state.input.distanceRow).toEqual(saved.input.distanceRow);
      expect(state.input.distances).toEqual([
        { distance: 50, arrowsPerEnd: 6, targetFaceId: null },
      ]);
      expect(window.sessionStorage.getItem("aims:history-view")).not.toContain(
        "totalArrows",
      );
    });

    it("距離の行を持つ入力値を書いて読むと、同じ距離の行が返り、型に無い距離の行の入力の鍵は書かない", () => {
      // Given
      const memory = createBrowserHistoryViewMemory(identityReader);

      // When
      memory.write(saved);
      const state = createBrowserHistoryViewMemory(identityReader).read();

      // Then
      expect(state.input.distanceRow).toEqual({
        distance: 30,
        arrowsPerEnd: 3,
        targetFaceId: null,
      });
      expect(window.sessionStorage.getItem("aims:history-view")).not.toContain(
        "distanceRowInput",
      );
    });

    it("保存値の向きが壊れていれば、その項目だけを既定にし、他の項目は保存値のままにして返す", () => {
      // Given
      window.sessionStorage.setItem(
        "aims:history-view",
        JSON.stringify({
          userId: "user-1",
          state: {
            input: {
              ...saved.input,
              dateDirection: "up",
              scoreDirection: "up",
            },
          },
        }),
      );
      const memory = createBrowserHistoryViewMemory(identityReader);

      // When
      const state = memory.read();

      // Then
      expect(state).toEqual({
        input: { ...saved.input, dateDirection: "desc", scoreDirection: null },
      });
    });

    it("何も書いていなければ、既定の状態を返す", () => {
      // Given
      const memory = createBrowserHistoryViewMemory(identityReader);

      // When
      const state = memory.read();

      // Then
      expect(state).toEqual(DEFAULT_HISTORY_VIEW_STATE);
    });

    it("別の利用者が書いた状態は引き継がず、既定の状態を返す", () => {
      // Given
      createBrowserHistoryViewMemory(identityReader).write(saved);
      signedInUser = "user-2";

      // When
      const state = createBrowserHistoryViewMemory(identityReader).read();

      // Then
      expect(state).toEqual(DEFAULT_HISTORY_VIEW_STATE);
    });

    it("端末に利用者の記録がなければ、書いた状態があっても既定の状態を返す", () => {
      // Given
      createBrowserHistoryViewMemory(identityReader).write(saved);
      signedInUser = null;

      // When
      const state = createBrowserHistoryViewMemory(identityReader).read();

      // Then
      expect(state).toEqual(DEFAULT_HISTORY_VIEW_STATE);
    });

    it.each([
      ["JSONとして読めない文字列", "{broken"],
      ["オブジェクトでないJSON", '"date"'],
      ["nullのJSON", "null"],
      ["利用者が文字列でない", JSON.stringify({ userId: 1, state: saved })],
      ["利用者が無い", JSON.stringify({ state: saved })],
    ])("保存された値が%sなら、例外にせず既定の状態を返す", (_name, raw) => {
      // Given
      window.sessionStorage.setItem("aims:history-view", raw);
      const memory = createBrowserHistoryViewMemory(identityReader);

      // When
      const state = memory.read();

      // Then
      expect(state).toEqual(DEFAULT_HISTORY_VIEW_STATE);
    });

    it("同じ利用者の保存値でも、状態の値が検証に通らなければ既定の状態を返す", () => {
      // Given
      // 状態を直す規則そのものは domain の historyViewStateOf で確かめる。ここでは、読み出しがその規則を通ることを確かめる。
      window.sessionStorage.setItem(
        "aims:history-view",
        JSON.stringify({ userId: "user-1", state: "date" }),
      );
      const memory = createBrowserHistoryViewMemory(identityReader);

      // When
      const state = memory.read();

      // Then
      expect(state).toEqual(DEFAULT_HISTORY_VIEW_STATE);
    });

    it("保存先を読めなければ、例外にせず既定の状態を返す", () => {
      // Given
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
      const memory = createBrowserHistoryViewMemory(identityReader);

      // When
      const state = memory.read();

      // Then
      expect(state).toEqual(DEFAULT_HISTORY_VIEW_STATE);
    });
  });

  describe("write", () => {
    it("端末に利用者の記録がなければ、何も書かない", () => {
      // Given
      signedInUser = null;
      const memory = createBrowserHistoryViewMemory(identityReader);

      // When
      memory.write(saved);

      // Then
      expect(window.sessionStorage.length).toBe(0);
    });

    it("保存先に書けなくても、例外にしない", () => {
      // Given
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("full", "QuotaExceededError");
      });
      const memory = createBrowserHistoryViewMemory(identityReader);

      // When
      const write = () => memory.write(saved);

      // Then
      expect(write).not.toThrow();
    });
  });
});

describe("eraseHistoryViewMemory", () => {
  it("このタブの記憶が指定した利用者のものなら消し、既定の状態に戻る", () => {
    // Given
    const memory = createBrowserHistoryViewMemory(identityReader);
    memory.write(saved);

    // When
    eraseHistoryViewMemory("user-1");

    // Then
    expect(window.sessionStorage.getItem("aims:history-view")).toBeNull();
    expect(memory.read()).toEqual(DEFAULT_HISTORY_VIEW_STATE);
  });

  it("別の利用者の記憶は消さない", () => {
    // Given
    const memory = createBrowserHistoryViewMemory(identityReader);
    memory.write(saved);

    // When
    eraseHistoryViewMemory("user-2");

    // Then
    expect(memory.read()).toEqual(saved);
  });

  it("記憶が無いとき、投げない", () => {
    // Given
    // When
    const erase = () => eraseHistoryViewMemory("user-1");

    // Then
    expect(erase).not.toThrow();
  });
});
