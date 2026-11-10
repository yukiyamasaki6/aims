import { describe, expect, it } from "vitest";
import type { Preset } from "./preset";
import { roundCreatedDraftOf } from "./round-start";

// UTCでは2026-09-29になる時刻。
const now = Date.parse("2026-09-29T12:00:00.000Z");

const preset: Preset = {
  id: "preset-1",
  name: "プリセット名",
  format: "indoor",
  bow_type: "compound",
  preset_distances: [
    {
      id: "d-second",
      position_key: "1-2",
      distance: 25,
      is_marked: false,
      total_ends: 10,
      arrows_per_end: 3,
      target_face_id: "face-2",
      target_faces: { size: 122, target_face_spots: [] },
    },
    {
      id: "d-first",
      position_key: "1-1",
      distance: 18,
      is_marked: true,
      total_ends: 20,
      arrows_per_end: 3,
      target_face_id: "face-1",
      target_faces: { size: 122, target_face_spots: [] },
    },
  ],
};

describe("roundCreatedDraftOf", () => {
  it("プリセットが無ければ、名前は空文字、屋外、リカーブ、距離無しの下書きを組み立てる", () => {
    // Given

    // When
    const draft = roundCreatedDraftOf(null, now, 0);

    // Then
    expect(draft).toEqual({
      type: "round.created",
      name: "",
      roundDate: "2026-09-29",
      format: "outdoor",
      bowType: "recurve",
      distances: [],
    });
  });

  it("プリセットがあれば、種別と弓種を使い、距離を位置の順に並べる。名前は転記せず、各距離はIDを持たない", () => {
    // Given

    // When
    const draft = roundCreatedDraftOf(preset, now, 0);

    // Then
    expect(draft).toEqual({
      type: "round.created",
      name: "",
      roundDate: "2026-09-29",
      format: "indoor",
      bowType: "compound",
      distances: [
        {
          positionKey: "1-1",
          distance: 18,
          isMarked: true,
          totalEnds: 20,
          arrowsPerEnd: 3,
          targetFaceId: "face-1",
        },
        {
          positionKey: "1-2",
          distance: 25,
          isMarked: false,
          totalEnds: 10,
          arrowsPerEnd: 3,
          targetFaceId: "face-2",
        },
      ],
    });
  });

  it.each([
    [
      "日本(+540)の0:00の1ミリ秒前",
      "2026-03-01T14:59:59.999Z",
      540,
      "2026-03-01",
    ],
    ["日本(+540)の0:00", "2026-03-01T15:00:00.000Z", 540, "2026-03-02"],
    ["日本(+540)の8:30", "2026-03-01T23:30:00.000Z", 540, "2026-03-02"],
    [
      "西(-480)の0:00の1ミリ秒前",
      "2026-03-02T07:59:59.999Z",
      -480,
      "2026-03-01",
    ],
    ["西(-480)の0:00", "2026-03-02T08:00:00.000Z", -480, "2026-03-02"],
    ["時差0のUTC 0:00", "2026-01-02T00:00:00.000Z", 0, "2026-01-02"],
    ["端数の時差(+345)の0:00", "2026-03-01T18:15:00.000Z", 345, "2026-03-02"],
    [
      "端数の時差(+345)の0:00の1ミリ秒前",
      "2026-03-01T18:14:59.999Z",
      345,
      "2026-03-01",
    ],
  ])(
    "実施日は、時差を足したローカルの日付になる(%s)",
    (_label, utc, offset, expected) => {
      // Given
      const instant = Date.parse(utc);

      // When
      const draft = roundCreatedDraftOf(null, instant, offset);

      // Then
      expect(draft.roundDate).toBe(expected);
    },
  );

  it("元のプリセットを変えない", () => {
    // Given

    // When
    roundCreatedDraftOf(preset, now, 0);

    // Then
    expect(preset.preset_distances.map((d) => d.position_key)).toEqual([
      "1-2",
      "1-1",
    ]);
  });
});
