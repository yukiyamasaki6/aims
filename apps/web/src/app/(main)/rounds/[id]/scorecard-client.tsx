"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { recordShot } from "./actions";

type Distance = {
  id: string;
  distance_number: number;
  distance: number;
  total_ends: number;
  arrows_per_end: number;
};

type Shot = {
  distance_id: string;
  end_number: number;
  arrow_number: number;
  score_str: string;
  score_int: number;
};

const SCORE_BUTTONS: { label: string; scoreStr: string; scoreInt: number }[] = [
  { label: "X", scoreStr: "X", scoreInt: 10 },
  { label: "10", scoreStr: "10", scoreInt: 10 },
  { label: "9", scoreStr: "9", scoreInt: 9 },
  { label: "8", scoreStr: "8", scoreInt: 8 },
  { label: "7", scoreStr: "7", scoreInt: 7 },
  { label: "6", scoreStr: "6", scoreInt: 6 },
  { label: "5", scoreStr: "5", scoreInt: 5 },
  { label: "4", scoreStr: "4", scoreInt: 4 },
  { label: "3", scoreStr: "3", scoreInt: 3 },
  { label: "2", scoreStr: "2", scoreInt: 2 },
  { label: "1", scoreStr: "1", scoreInt: 1 },
  { label: "M", scoreStr: "M", scoreInt: 0 },
];

function findCurrentPosition(distances: Distance[], shots: Shot[]) {
  for (const d of distances) {
    for (let end = 1; end <= d.total_ends; end++) {
      for (let arrow = 1; arrow <= d.arrows_per_end; arrow++) {
        const recorded = shots.some(
          (s) =>
            s.distance_id === d.id &&
            s.end_number === end &&
            s.arrow_number === arrow,
        );
        if (!recorded) {
          return { distance: d, end, arrow };
        }
      }
    }
  }
  return null;
}

export function ScorecardClient({
  distances,
  initialShots,
}: {
  distances: Distance[];
  initialShots: Shot[];
}) {
  const [shots, setShots] = useState<Shot[]>(initialShots);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const position = useMemo(
    () => findCurrentPosition(distances, shots),
    [distances, shots],
  );
  const total = useMemo(
    () => shots.reduce((sum, s) => sum + s.score_int, 0),
    [shots],
  );
  const xCount = shots.filter((s) => s.score_str === "X").length;
  const tenCount = shots.filter((s) => s.score_str === "10").length;

  async function handleScore(scoreStr: string, scoreInt: number) {
    if (!position || submitting) return;
    setSubmitting(true);
    setError(null);

    const { distance, end, arrow } = position;
    const result = await recordShot({
      distanceId: distance.id,
      endNumber: end,
      arrowNumber: arrow,
      scoreStr,
      scoreInt,
    });

    if (result?.error) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    setShots((prev) => [
      ...prev.filter(
        (s) =>
          !(
            s.distance_id === distance.id &&
            s.end_number === end &&
            s.arrow_number === arrow
          ),
      ),
      {
        distance_id: distance.id,
        end_number: end,
        arrow_number: arrow,
        score_str: scoreStr,
        score_int: scoreInt,
      },
    ]);
    setSubmitting(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-8">
      <div className="text-center">
        <p className="text-2xl font-bold">合計 {total}点</p>
        <p className="text-muted-foreground text-sm">
          X: {xCount} / 10: {tenCount}
        </p>
        {position ? (
          <p className="text-lg font-bold">
            {position.distance.distance}m {position.end}エンド目 /{" "}
            {position.distance.total_ends}エンド
          </p>
        ) : (
          <p className="text-lg font-bold">全エンド入力完了</p>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {distances.map((d) => {
          const endsWithShots = Array.from(
            { length: d.total_ends },
            (_, i) => i + 1,
          ).filter((end) =>
            shots.some((s) => s.distance_id === d.id && s.end_number === end),
          );
          if (endsWithShots.length === 0) {
            return null;
          }
          return (
            <div key={d.id} className="flex flex-col gap-1">
              {distances.length > 1 && (
                <p className="text-muted-foreground text-xs">{d.distance}m</p>
              )}
              {endsWithShots.map((end) => {
                const endShots = shots.filter(
                  (s) => s.distance_id === d.id && s.end_number === end,
                );
                const subtotal = endShots.reduce(
                  (sum, s) => sum + s.score_int,
                  0,
                );
                return (
                  <div key={end} className="flex justify-between text-sm">
                    <span>{end}エンド目</span>
                    <span>
                      {endShots
                        .toSorted((a, b) => a.arrow_number - b.arrow_number)
                        .map((s) => s.score_str)
                        .join(" ")}
                      （{subtotal}点）
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {position && (
        <div className="grid grid-cols-4 gap-2">
          {SCORE_BUTTONS.map((b) => (
            <Button
              key={b.label}
              type="button"
              variant="outline"
              disabled={submitting}
              data-testid={`score-button-${b.label}`}
              onClick={() => handleScore(b.scoreStr, b.scoreInt)}
            >
              {b.label}
            </Button>
          ))}
        </div>
      )}
    </main>
  );
}
