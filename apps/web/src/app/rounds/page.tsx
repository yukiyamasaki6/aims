import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function RoundsPage() {
  const supabase = await createClient();

  const { data: rounds } = await supabase
    .from("rounds")
    .select("id, name, round_date, distances(shots(score_int))")
    .order("round_date", { ascending: false });

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 p-8">
      <h1 className="text-2xl font-bold">ラウンド一覧</h1>

      {!rounds || rounds.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          まだラウンドがありません。
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rounds.map((round) => {
            const total = round.distances
              .flatMap((d) => d.shots)
              .reduce((sum, s) => sum + s.score_int, 0);

            return (
              <li key={round.id}>
                <Link
                  href={`/rounds/${round.id}`}
                  className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted"
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{round.name}</span>
                    <span className="text-muted-foreground text-sm">
                      {round.round_date}
                    </span>
                  </span>
                  <span className="font-bold">{total}点</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
