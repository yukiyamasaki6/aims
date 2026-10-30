import { afterEach, describe, expect, it } from "vitest";
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
      target_faces: null,
    },
    {
      id: "d-first",
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

const originalTz = process.env.TZ;

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("roundCreatedDraftOf", () => {
  it("プリセットが無ければ、名前は空文字、屋外、リカーブ、距離無しの下書きを組み立てる", () => {
    // Given

    // When
    const draft = roundCreatedDraftOf(null, now);

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
    const draft = roundCreatedDraftOf(preset, now);

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

  it("実施日はnowのUTCの日付で、実行環境のローカルの日付ではない(UTC 0時の前後を境にする)", () => {
    // Given
    // ローカル日付との取り違えを検出するため、非UTCのタイムゾーンで実行する。
    process.env.TZ = "Asia/Tokyo";
    const beforeUtcMidnight = Date.parse("2026-01-01T23:59:59.999Z");
    const atUtcMidnight = Date.parse("2026-01-02T00:00:00.000Z");
    const localDateDiffers = Date.parse("2026-01-01T15:00:00Z");

    // When
    const before = roundCreatedDraftOf(null, beforeUtcMidnight);
    const at = roundCreatedDraftOf(null, atUtcMidnight);
    const differs = roundCreatedDraftOf(null, localDateDiffers);

    // Then
    expect(before.roundDate).toBe("2026-01-01");
    expect(at.roundDate).toBe("2026-01-02");
    expect(differs.roundDate).toBe("2026-01-01");
  });

  it("元のプリセットを変えない", () => {
    // Given

    // When
    roundCreatedDraftOf(preset, now);

    // Then
    expect(preset.preset_distances.map((d) => d.position_key)).toEqual([
      "1-2",
      "1-1",
    ]);
  });
});
