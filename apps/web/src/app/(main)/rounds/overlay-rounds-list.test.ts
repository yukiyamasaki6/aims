import { describe, expect, it } from "vitest";
import type { RoundListItem } from "./fetch-rounds-list";
import { overlayRoundsList } from "./overlay-rounds-list";

function item(id: string): RoundListItem {
  return { id, name: id, roundDate: "2026-09-15", total: 0 };
}

describe("overlayRoundsList", () => {
  it("削除済みのラウンドを除き、取得の順序を保つ", () => {
    const result = overlayRoundsList(
      [item("c"), item("a"), item("b")],
      new Set(["a"]),
    );

    expect(result.map((round) => round.id)).toEqual(["c", "b"]);
  });

  it("削除済みが無ければ、そのまま返す", () => {
    const fetched = [item("a"), item("b")];

    expect(overlayRoundsList(fetched, new Set())).toEqual(fetched);
  });

  it("取得に無い削除済みのIDは、何もしない", () => {
    expect(overlayRoundsList([item("a")], new Set(["z"]))).toEqual([item("a")]);
  });
});
