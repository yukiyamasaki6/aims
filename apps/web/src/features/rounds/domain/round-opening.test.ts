import { describe, expect, it } from "vitest";
import {
  roundBase,
  roundCreated,
  roundDisabled,
} from "./round-op-test-helpers";
import { localOpening, openPlan } from "./round-opening";
import type { TargetFaceOption } from "./target-face";

describe("openPlan", () => {
  it("削除があれば削除、確定していない作成があれば作成、それ以外は取得にする", () => {
    // Given
    const created = roundCreated();

    // When
    const deleted = openPlan({
      base: undefined,
      entries: [{ operation: created }, { operation: roundDisabled() }],
    });
    const creation = openPlan({
      base: undefined,
      entries: [{ operation: created }],
    });
    const fetch = openPlan({
      base: undefined,
      entries: [{ operation: created, ackedRevision: 1 }],
    });
    const noEntries = openPlan({ base: undefined, entries: [] });

    // Then
    expect(deleted).toEqual({ kind: "deleted" });
    expect(creation).toEqual({ kind: "creation", operation: created });
    expect(fetch).toEqual({ kind: "fetch" });
    expect(noEntries).toEqual({ kind: "fetch" });
  });

  it("削除と確定していない作成が重なるときは、削除を優先する", () => {
    // Given
    const entries = [
      { operation: roundCreated() },
      { operation: roundDisabled() },
    ];

    // When
    const plan = openPlan({ base: undefined, entries });

    // Then
    expect(plan).toEqual({ kind: "deleted" });
  });
});

describe("localOpening", () => {
  const savedFaces: TargetFaceOption[] = [
    {
      id: "face-1",
      name: "122cm",
      size: 122,
      format: "outdoor",
      bow_type: ["recurve"],
      target_face_spots: [],
    },
  ];

  it("端末のベースと保存した的があるときは、端末のベースと的で開く", () => {
    // Given
    const stored = roundBase();
    const group = { base: { startedAt: 1, base: stored }, entries: [] };

    // When
    const opening = localOpening(group, savedFaces);

    // Then
    expect(opening).toEqual({ base: stored.tables, targetFaces: savedFaces });
  });

  it("ベースが無い、削除の印、保存した的が無いときは、開けない", () => {
    // Given
    // When
    const noBase = localOpening({ base: undefined, entries: [] }, savedFaces);
    const marker = localOpening(
      { base: { startedAt: 1, base: null }, entries: [] },
      savedFaces,
    );
    const noFaces = localOpening(
      { base: { startedAt: 1, base: roundBase() }, entries: [] },
      null,
    );

    // Then
    expect([noBase, marker, noFaces]).toEqual([null, null, null]);
  });
});
