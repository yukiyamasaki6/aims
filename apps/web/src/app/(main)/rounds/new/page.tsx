"use client";

import { unstable_rethrow } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createRound } from "./actions";

type Distance = {
  distance: string;
  totalEnds: string;
  arrowsPerEnd: string;
};

const emptyDistance: Distance = {
  distance: "",
  totalEnds: "",
  arrowsPerEnd: "",
};

export default function NewRoundPage() {
  const [name, setName] = useState("");
  const [roundDate, setRoundDate] = useState("");
  const [distances, setDistances] = useState<Distance[]>([
    { ...emptyDistance },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function updateDistance(index: number, patch: Partial<Distance>) {
    setDistances((prev) =>
      prev.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    );
  }

  function addDistance() {
    setDistances((prev) => [...prev, { ...emptyDistance }]);
  }

  function removeDistance(index: number) {
    setDistances((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await createRound({
        name,
        roundDate,
        distances: distances.map((d) => ({
          distance: Number(d.distance),
          totalEnds: Number(d.totalEnds),
          arrowsPerEnd: Number(d.arrowsPerEnd),
        })),
      });

      if (result?.error) {
        setError(result.error);
      }
    } catch (e) {
      // redirect()はNext.js内部的にNEXT_REDIRECT例外をthrowして遷移を実行するため、
      // ここで握りつぶさず再送出する。
      unstable_rethrow(e);
      setError("通信に失敗しました。もう一度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-8">
      <h1 className="font-heading text-2xl leading-snug font-medium">
        ラウンドを作成
      </h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="round-name">ラウンド名</label>
          <Input
            id="round-name"
            required
            placeholder="例: 第2回紅白戦"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="round-date">実施日</label>
          <Input
            id="round-date"
            type="date"
            required
            value={roundDate}
            onChange={(e) => setRoundDate(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-sm font-medium">距離構成</span>
          {distances.map((d, i) => (
            <div
              key={`distance-${
                // biome-ignore lint/suspicious/noArrayIndexKey: 並び替えがなく、追加・削除は末尾/自身のみのため安全
                i
              }`}
              data-testid="distance-row"
              className="flex items-end gap-2 rounded-xl border bg-card p-3 text-card-foreground shadow-sm"
            >
              <div className="flex flex-1 flex-col gap-1 text-sm">
                <label htmlFor={`distance-${i}`}>距離(m)</label>
                <Input
                  id={`distance-${i}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  required
                  value={d.distance}
                  onChange={(e) =>
                    updateDistance(i, { distance: e.target.value })
                  }
                />
              </div>
              <div className="flex flex-1 flex-col gap-1 text-sm">
                <label htmlFor={`total-ends-${i}`}>総エンド数</label>
                <Input
                  id={`total-ends-${i}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  required
                  value={d.totalEnds}
                  onChange={(e) =>
                    updateDistance(i, { totalEnds: e.target.value })
                  }
                />
              </div>
              <div className="flex flex-1 flex-col gap-1 text-sm">
                <label htmlFor={`arrows-per-end-${i}`}>
                  エンドあたりの本数
                </label>
                <Input
                  id={`arrows-per-end-${i}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  required
                  value={d.arrowsPerEnd}
                  onChange={(e) =>
                    updateDistance(i, { arrowsPerEnd: e.target.value })
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                disabled={distances.length === 1}
                onClick={() => removeDistance(i)}
              >
                削除
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={addDistance}>
            距離を追加
          </Button>
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}

        <Button type="submit" disabled={submitting}>
          ラウンドを作成
        </Button>
      </form>
    </main>
  );
}
