"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  const [keypadOpen, setKeypadOpen] = useState(true);

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
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-8 pb-40">
      <div
        data-testid="round-summary"
        className="flex items-baseline justify-center gap-2 rounded-xl border bg-card p-4 text-card-foreground shadow-sm"
      >
        <span className="font-heading text-2xl font-semibold">合計{total}</span>
        <span className="text-muted-foreground text-sm">
          X: {xCount} / 10: {tenCount}
        </span>
      </div>

      <div className="flex flex-col gap-4">
        {distances.map((d) => {
          const distanceShots = shots.filter((s) => s.distance_id === d.id);
          const distanceTotal = distanceShots.reduce(
            (sum, s) => sum + s.score_int,
            0,
          );
          const distanceXCount = distanceShots.filter(
            (s) => s.score_str === "X",
          ).length;
          const distanceTenCount = distanceShots.filter(
            (s) => s.score_str === "10",
          ).length;

          return (
            <div
              key={d.id}
              className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm"
            >
              {distances.length > 1 && (
                <div
                  data-testid={`distance-summary-${d.distance_number}`}
                  className="flex items-baseline justify-between gap-2 border-b px-3 py-2 text-muted-foreground text-xs"
                >
                  <span>{d.distance}m</span>
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-foreground text-sm font-semibold">
                      小計{distanceTotal}
                    </span>
                    <span>
                      X: {distanceXCount} / 10: {distanceTenCount}
                    </span>
                  </span>
                </div>
              )}
              <div className="divide-y">
                {Array.from({ length: d.total_ends }, (_, i) => i + 1).map(
                  (end) => {
                    const endShots = shots.filter(
                      (s) => s.distance_id === d.id && s.end_number === end,
                    );
                    const subtotal = endShots.reduce(
                      (sum, s) => sum + s.score_int,
                      0,
                    );
                    const hasAnyShot = endShots.length > 0;

                    return (
                      <div key={end} className="flex items-stretch">
                        <div className="flex w-8 shrink-0 items-center justify-center border-r text-muted-foreground text-xs">
                          {end}
                        </div>
                        <div
                          className="grid flex-1 divide-x"
                          style={{
                            gridTemplateColumns: `repeat(${d.arrows_per_end}, minmax(0, 1fr))`,
                          }}
                        >
                          {Array.from(
                            { length: d.arrows_per_end },
                            (_, i) => i + 1,
                          ).map((arrow) => {
                            const shot = endShots.find(
                              (s) => s.arrow_number === arrow,
                            );
                            const isActive =
                              position?.distance.id === d.id &&
                              position.end === end &&
                              position.arrow === arrow;

                            return (
                              <div
                                key={arrow}
                                data-testid={`shot-cell-${d.distance_number}-${end}-${arrow}`}
                                className={cn(
                                  "flex min-h-10 items-center justify-center py-2 text-base font-medium",
                                  isActive &&
                                    "bg-primary/10 text-primary ring-2 ring-primary ring-inset",
                                )}
                              >
                                {shot?.score_str ?? ""}
                              </div>
                            );
                          })}
                        </div>
                        <div
                          data-testid={`end-subtotal-${d.distance_number}-${end}`}
                          className="flex min-h-10 w-14 shrink-0 items-center justify-center border-l text-muted-foreground text-base"
                        >
                          {hasAnyShot ? `${subtotal}` : ""}
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {position && (
        <div className="fixed inset-x-0 bottom-0 border-t bg-card shadow-lg">
          <div className="mx-auto max-w-xl">
            <button
              type="button"
              data-testid="keypad-toggle"
              onClick={() => setKeypadOpen((v) => !v)}
              aria-label={keypadOpen ? "テンキーを閉じる" : "テンキーを開く"}
              className="flex w-full items-center justify-center py-1.5 text-muted-foreground hover:text-foreground"
            >
              {keypadOpen ? (
                <ChevronDown className="size-5" />
              ) : (
                <ChevronUp className="size-5" />
              )}
            </button>
            {keypadOpen && (
              <div className="grid grid-cols-4 gap-2 p-4 pt-0">
                {SCORE_BUTTONS.map((b) => (
                  <Button
                    key={b.label}
                    type="button"
                    variant="outline"
                    size="lg"
                    disabled={submitting}
                    data-testid={`score-button-${b.label}`}
                    onClick={() => handleScore(b.scoreStr, b.scoreInt)}
                  >
                    {b.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
