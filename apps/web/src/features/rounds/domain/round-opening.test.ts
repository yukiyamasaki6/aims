import { describe, expect, it } from "vitest";
import type { FetchResult } from "./fetch-status";
import {
  roundBase,
  roundCreated,
  roundDisabled,
} from "./round-op-test-helpers";
import {
  isUnknownToServer,
  type OpeningInput,
  roundOpening,
} from "./round-opening";
import type { TargetFaceOption } from "./target-face";

const faces: TargetFaceOption[] = [
  {
    id: "face-1",
    name: "122cm",
    size: 122,
    format: "outdoor",
    bow_type: ["recurve"],
    target_face_spots: [],
  },
];

const created = { operation: roundCreated(), confirmedFields: undefined };
const deletion = { operation: roundDisabled(), confirmedFields: undefined };
const stored = roundBase({ name: "端末" });

function input(overrides: Partial<OpeningInput> = {}): OpeningInput {
  return {
    record: { base: undefined, operations: [] },
    deletedAtStart: false,
    savedFaces: faces,
    roundFetch: null,
    facesFetch: null,
    ...overrides,
  };
}

const offline: FetchResult<never> = { status: "offline" };
const failedFetch: FetchResult<never> = {
  status: "error",
  reason: "unauthenticated",
};

describe("roundOpening", () => {
  it("1: 記録のベースがnull(削除済み)、または最初の判定で削除の操作があったときは、存在しない", () => {
    // Given
    const markedDeleted = input({
      record: { base: { startedAt: 1, base: null }, operations: [created] },
    });
    const deletedAtStart = input({
      record: { base: { startedAt: 1, base: stored }, operations: [deletion] },
      deletedAtStart: true,
    });

    // When
    const first = roundOpening(markedDeleted);
    const second = roundOpening(deletedAtStart);

    // Then
    expect(first).toEqual({ status: "not-found" });
    expect(second).toEqual({ status: "not-found" });
  });

  it("2: 起点(ベース、無ければ作成の操作)と保存済みの的があれば、取得の結果によらず準備完了にする", () => {
    // Given
    const withBase = input({
      record: { base: { startedAt: 1, base: stored }, operations: [] },
      roundFetch: failedFetch,
    });
    const withCreation = input({
      record: { base: undefined, operations: [created] },
      roundFetch: offline,
      facesFetch: offline,
    });

    // When
    const first = roundOpening(withBase);
    const second = roundOpening(withCreation);

    // Then
    expect(first).toEqual({
      status: "ok",
      data: { origin: stored.tables, savedFaces: faces },
    });
    expect(second.status).toBe("ok");
  });

  it("保存済みの的が空の一覧でも、保存済みとして準備完了にする", () => {
    // Given
    const empty = input({
      record: { base: { startedAt: 1, base: stored }, operations: [] },
      savedFaces: [],
    });

    // When
    const view = roundOpening(empty);

    // Then
    expect(view.status).toBe("ok");
  });

  it("3,4: 起点が無い間は、ラウンドの取得の結果で決める。結果待ち、取得の前、記録に入らない結果は読み込み中", () => {
    // Given
    const base = input();

    // When
    const pending = roundOpening(base);
    const offlineView = roundOpening({ ...base, roundFetch: offline });
    const errorView = roundOpening({ ...base, roundFetch: failedFetch });
    const okNoRecord = roundOpening({
      ...base,
      roundFetch: { status: "ok", data: null },
    });
    const notFoundNoRecord = roundOpening({
      ...base,
      roundFetch: { status: "not-found" },
    });

    // Then
    expect(pending).toEqual({ status: "loading" });
    expect(offlineView).toEqual({ status: "offline" });
    expect(errorView).toEqual({ status: "error", reason: "unauthenticated" });
    expect(okNoRecord).toEqual({ status: "loading" });
    expect(notFoundNoRecord).toEqual({ status: "loading" });
  });

  it("5,6: 起点はあるが的が無いときは、的の取得の結果で決める(ラウンドの取得は見ない)", () => {
    // Given
    const base = input({
      record: { base: { startedAt: 1, base: stored }, operations: [] },
      savedFaces: null,
      roundFetch: failedFetch,
    });

    // When
    const pending = roundOpening(base);
    const offlineView = roundOpening({ ...base, facesFetch: offline });
    const errorView = roundOpening({ ...base, facesFetch: failedFetch });
    const savedButNotRead = roundOpening({
      ...base,
      facesFetch: { status: "ok", data: faces },
    });

    // Then
    expect(pending).toEqual({ status: "loading" });
    expect(offlineView).toEqual({ status: "offline" });
    expect(errorView).toEqual({ status: "error", reason: "unauthenticated" });
    expect(savedButNotRead).toEqual({ status: "loading" });
  });
});

describe("isUnknownToServer", () => {
  const createdOp = roundCreated();
  const item = (ackedRevision?: number) => ({
    operation: createdOp,
    ackedRevision,
  });

  it("ベースが無く、未確定の作成の操作があるときだけ、サーバーに無いと判断する", () => {
    // Given
    const base = { startedAt: 1, base: null };

    // When
    const unconfirmed = isUnknownToServer({ base: undefined, items: [item()] });
    const confirmed = isUnknownToServer({ base: undefined, items: [item(1)] });
    const empty = isUnknownToServer({ base: undefined, items: [] });
    const withBase = isUnknownToServer({ base, items: [item()] });

    // Then
    expect(unconfirmed).toBe(true);
    expect(confirmed).toBe(false);
    expect(empty).toBe(false);
    expect(withBase).toBe(false);
  });
});
