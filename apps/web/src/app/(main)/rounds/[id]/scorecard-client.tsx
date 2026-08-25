"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clearShot, recordShot } from "./actions";

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

// テンキー（クリア行+スコア行+トグルボタン）の実測高さ。中身は固定内容なので
// 定数として扱う。中身のレイアウトを変えた場合はここも合わせて更新すること。
const KEYPAD_HEIGHT = 220;

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

type Position = { distance: Distance; end: number; arrow: number };

function findCurrentPosition(
  distances: Distance[],
  shots: Shot[],
): Position | null {
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

function flattenCells(distances: Distance[]): Position[] {
  const cells: Position[] = [];
  for (const d of distances) {
    for (let end = 1; end <= d.total_ends; end++) {
      for (let arrow = 1; arrow <= d.arrows_per_end; arrow++) {
        cells.push({ distance: d, end, arrow });
      }
    }
  }
  return cells;
}

function stepPosition(
  distances: Distance[],
  current: Position,
  offset: 1 | -1,
): Position | null {
  const cells = flattenCells(distances);
  const index = cells.findIndex(
    (c) =>
      c.distance.id === current.distance.id &&
      c.end === current.end &&
      c.arrow === current.arrow,
  );
  if (index === -1) return null;
  return cells[index + offset] ?? null;
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
  // keypadOpenの変化をそのままアンマウントすると格納アニメーションが再生できないため、
  // トランジション終了後に実際にアンマウントするまでの間だけmountedをtrueに保つ。
  const [keypadMounted, setKeypadMounted] = useState(true);
  const [keypadVisible, setKeypadVisible] = useState(true);
  const [position, setPosition] = useState<Position | null>(() =>
    findCurrentPosition(distances, initialShots),
  );
  const keypadRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  const closeKeypad = useCallback(() => {
    setKeypadOpen(false);
    (document.activeElement as HTMLElement | null)?.blur();
  }, []);

  useEffect(() => {
    if (keypadOpen) {
      setKeypadMounted(true);
      // マウント直後の1フレーム目でtrueにするとブラウザがtranslate-y-fullを描画
      // する前に遷移先の状態へ変わってしまいアニメーションしないため、
      // 1フレーム待ってから変更する。
      const raf1 = requestAnimationFrame(() => {
        const raf2 = requestAnimationFrame(() => setKeypadVisible(true));
        rafRef.current = raf2;
      });
      rafRef.current = raf1;
      return () => cancelAnimationFrame(rafRef.current);
    }

    setKeypadVisible(false);
    const timeout = setTimeout(() => setKeypadMounted(false), 200);
    return () => clearTimeout(timeout);
  }, [keypadOpen]);

  useEffect(() => {
    function handleDocumentClick(e: MouseEvent) {
      // e.targetはハンドラ実行までにアイコンの差し替え等でDOMから外れている
      // ことがあるため、dispatch時点のパスを保持するcomposedPath()で判定する。
      const path = e.composedPath();
      if (keypadRef.current && path.includes(keypadRef.current)) return;
      const clickedShotCell = path.some(
        (el) =>
          el instanceof HTMLElement &&
          el.dataset.testid?.startsWith("shot-cell-"),
      );
      if (clickedShotCell) return;
      closeKeypad();
    }

    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, [closeKeypad]);

  useEffect(() => {
    if (!position) return;
    const testId = `shot-cell-${position.distance.distance_number}-${position.end}-${position.arrow}`;
    const cell = document.querySelector(`[data-testid="${testId}"]`);
    const container = cell?.closest<HTMLElement>(".overflow-y-auto");
    if (!cell || !container) return;

    // マスを選択すれば必ずテンキーが開く前提のため、開閉状態に関わらず常に
    // テンキー分の高さが隠れることを見込んでスクロール位置を計算する
    // （高さ確保用の透明な枠は常にKEYPAD_HEIGHT分の領域を占有している）。
    const margin = 16;
    const cellRect = cell.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const visibleBottom = containerRect.bottom - KEYPAD_HEIGHT - margin;

    let delta = 0;
    if (cellRect.bottom > visibleBottom) {
      delta = cellRect.bottom - visibleBottom;
    } else if (cellRect.top < containerRect.top + margin) {
      delta = cellRect.top - (containerRect.top + margin);
    }

    if (delta !== 0) {
      container.scrollBy({ top: delta, behavior: "smooth" });
    }
  }, [position]);

  const total = shots.reduce((sum, s) => sum + s.score_int, 0);
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
    setPosition(stepPosition(distances, position, 1));
    setSubmitting(false);
  }

  async function handleClear() {
    if (!position || submitting) return;
    setSubmitting(true);
    setError(null);

    const result = await clearShot({
      distanceId: position.distance.id,
      endNumber: position.end,
      arrowNumber: position.arrow,
    });

    if (result?.error) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    setShots((prev) =>
      prev.filter(
        (s) =>
          !(
            s.distance_id === position.distance.id &&
            s.end_number === position.end &&
            s.arrow_number === position.arrow
          ),
      ),
    );
    setPosition(stepPosition(distances, position, -1) ?? position);
    setSubmitting(false);
  }

  function selectCell(distance: Distance, end: number, arrow: number) {
    // 格納後に再度開く場合、keypadMountedがマウント用useEffectを経由して
    // 遅れて反映されると、スクロール計算がkeypadRef未接続のまま実行されて
    // しまうため、ここで同期的にマウント済みにしておく。
    setKeypadMounted(true);
    setPosition({ distance, end, arrow });
    setKeypadOpen(true);
  }

  return (
    <main className="flex min-h-full flex-col">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-8">
        <div
          data-testid="round-summary"
          className="flex items-baseline justify-center gap-2 rounded-xl border bg-card p-4 text-card-foreground shadow-sm"
        >
          <span className="font-heading text-2xl font-semibold">
            合計{total}
          </span>
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
                                <button
                                  key={arrow}
                                  type="button"
                                  data-testid={`shot-cell-${d.distance_number}-${end}-${arrow}`}
                                  onClick={() => selectCell(d, end, arrow)}
                                  className={cn(
                                    "flex min-h-10 items-center justify-center py-2 text-base font-medium transition-colors hover:bg-muted/60",
                                    isActive &&
                                      "bg-primary/10 text-primary ring-2 ring-primary ring-inset",
                                  )}
                                >
                                  {shot?.score_str ?? ""}
                                </button>
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
      </div>

      {position && (
        // 高さ確保用の透明な枠。常にKEYPAD_HEIGHT分の領域をスクロール可能域として
        // 確保しておくことで、展開アニメーションの進み具合に関わらずスクロール
        // 計算が安定する。クリックも透過させ、実際の操作は下の実体側で受ける。
        <div
          className="sticky bottom-0 pointer-events-none"
          style={{ height: KEYPAD_HEIGHT }}
        >
          {keypadMounted && (
            <div
              ref={keypadRef}
              className={cn(
                "pointer-events-auto absolute inset-0 border-t bg-card shadow-lg transition-transform duration-200",
                keypadVisible ? "translate-y-0" : "translate-y-full",
              )}
            >
              <div className="mx-auto max-w-xl">
                <button
                  type="button"
                  data-testid="keypad-toggle"
                  onClick={closeKeypad}
                  aria-label="テンキーを閉じる"
                  className="flex w-full items-center justify-center py-1.5 text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown className="size-5" />
                </button>
                <div className="flex flex-col gap-2 p-4 pt-0">
                  <div className="grid grid-cols-4 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="col-start-2 col-span-2"
                      disabled={submitting}
                      data-testid="score-button-clear"
                      onClick={handleClear}
                    >
                      クリア
                    </Button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
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
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
