import type { SupabaseClient } from "@supabase/supabase-js";
import { readSession } from "@/features/auth/session-state";
import type { Database } from "@/types/supabase";
import { roundOpHub } from "../_shared/round-op-hub";
import { roundOpLog } from "../_shared/round-op-log";
import {
  type FetchedRoundDetails,
  fetchRoundDetails,
} from "./fetch-round-detail";
import { roundTablesFromServer } from "./round-tables";

// 取得の結果を端末の組へ反映する。返ったラウンドはベースにし、返らなかった保持のラウンドは削除の印にする。
// 全ての反映を待って解決する。ユーザーの確認は呼び出し側が行う(取得のユーザーと違えば、ハブが端末へ保存しない)。
export async function commitRoundDetails(
  fetched: FetchedRoundDetails,
  retained: readonly string[],
): Promise<void> {
  const { rounds, startedAt, userId: fetchedUserId } = fetched;
  const commits: Promise<unknown>[] = [];
  for (const [roundId, detail] of rounds) {
    const { roundConfig, status, distances, shots, revisions } = detail;
    commits.push(
      roundOpLog.commit(
        roundId,
        {
          tables: roundTablesFromServer({
            roundConfig,
            status,
            distances,
            shots,
          }),
          revisions,
        },
        detail.startedAt,
        detail.userId,
      ),
    );
  }
  for (const roundId of retained) {
    if (!rounds.has(roundId)) {
      commits.push(roundOpLog.commit(roundId, null, startedAt, fetchedUserId));
    }
  }
  await Promise.all(commits);
}

// 入力中のラウンドと、端末が保持するラウンドを、まとめて取得して端末の組へ反映する。
// ラウンドごとの反映の後に、取得が返らなかった保持のラウンドは削除の印にする。的は取得の中で端末へ保存される。
// 全ての反映を待って成功(true)とする。通信できない、未認証、端末の識別と違うユーザーのときは、何もせずfalseを返す。
export async function refreshRoundBases(
  supabase: SupabaseClient<Database>,
): Promise<boolean> {
  try {
    const state = await readSession(supabase);
    if (
      state.status !== "authenticated" ||
      state.session.user.id !== roundOpHub.getUserId()
    ) {
      return false;
    }

    const retained = await roundOpLog.retainedRoundIds();
    const fetched = await fetchRoundDetails(supabase, retained);
    if (fetched.status !== "ok") return false;

    await commitRoundDetails(fetched.data, retained);
    return true;
  } catch {
    return false;
  }
}
