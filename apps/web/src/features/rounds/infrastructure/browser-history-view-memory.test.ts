import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HISTORY_VIEW_STATE,
  type HistoryViewState,
} from "../domain/history-view-state";
import { createBrowserHistoryViewMemory } from "./browser-history-view-memory";

const saved: HistoryViewState = {
  condition: {
    sortKey: "score",
    sortDirection: "asc",
    format: "indoor",
    bowType: "compound",
    dateFrom: "2026-05-01",
    dateTo: "2026-05-31",
    scoreMin: 0,
    scoreMax: 600,
    distances: [
      {
        distance: 50,
        arrowsPerEnd: 6,
        totalArrows: 36,
        targetFaceId: "a1000000-0000-0000-0000-000000000001",
      },
      {
        distance: 30,
        arrowsPerEnd: null,
        totalArrows: null,
        targetFaceId: null,
      },
    ],
  },
  filterOpen: false,
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

    it("期間と得点の範囲と距離の構成の項目が無い旧い保存値は、範囲を指定なし、距離の構成を空の配列にし、他の項目は保存値のままにして返す", () => {
      // Given
      const {
        dateFrom,
        dateTo,
        scoreMin,
        scoreMax,
        distances,
        ...legacyCondition
      } = saved.condition;
      window.sessionStorage.setItem(
        "aims:history-view",
        JSON.stringify({
          userId: "user-1",
          state: { condition: legacyCondition, filterOpen: false },
        }),
      );
      const memory = createBrowserHistoryViewMemory(identityReader);

      // When
      const state = memory.read();

      // Then
      expect(state).toEqual({
        condition: {
          ...legacyCondition,
          dateFrom: null,
          dateTo: null,
          scoreMin: null,
          scoreMax: null,
          distances: [],
        },
        filterOpen: false,
      });
    });

    it("保存値の距離の構成の行が型に合わなければ、距離の構成だけを空の配列にし、他の項目は保存値のままにして返す", () => {
      // Given
      const brokenRows = [
        { ...saved.condition.distances[0], targetFaceId: "not-a-uuid" },
        saved.condition.distances[1],
      ];
      window.sessionStorage.setItem(
        "aims:history-view",
        JSON.stringify({
          userId: "user-1",
          state: {
            condition: { ...saved.condition, distances: brokenRows },
            filterOpen: false,
          },
        }),
      );
      const memory = createBrowserHistoryViewMemory(identityReader);

      // When
      const state = memory.read();

      // Then
      expect(state).toEqual({
        condition: { ...saved.condition, distances: [] },
        filterOpen: false,
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
