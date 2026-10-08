import type { SupabaseClient } from "@supabase/supabase-js";
import type { FetchResult } from "@/features/fetch-result/fetch-result";
import type { Database } from "@/types/supabase";
import { loadReferenceSnapshot } from "./_shared/reference-snapshot";
import { hasRoundDeletion, roundOpLog } from "./_shared/round-op-log";
import type { TargetFaceOption } from "./[id]/distance-config-row";
import { fetchRoundDetails } from "./[id]/fetch-round-detail";
import { commitRoundDetails } from "./[id]/refresh-round-bases";
import { deriveRoundState, isRoundInProgress } from "./[id]/round-base";
import { fetchRoundsList, type RoundListItem } from "./fetch-rounds-list";

export type LoadedRoundsList = {
  // サーバーの一覧。端末の列は重ねていない。入力中のラウンドも含む。
  items: RoundListItem[];
  // 取得を端末の組へ反映した後に求めた、入力中のラウンド。
  inProgress: RoundListItem[];
  // 端末の列で削除済みのラウンドのID。
  deleted: ReadonlySet<string>;
  // 取得の前に削除が確定していたラウンドのID。一覧の表示の開始時に、削除の印として端末の組へ反映する。
  confirmedDeletions: string[];
  // `confirmedDeletions`を反映するときの、取得の開始時刻。
  startedAt: number;
};

// 端末の組だけから求めた、入力中のラウンドと削除済みのラウンドのID。
export type LocalRoundsList = {
  inProgress: RoundListItem[];
  deleted: ReadonlySet<string>;
};

// 端末の各組から、詳細と同じ導出(`deriveRoundState`)と表示の規則(`isRoundInProgress`)で入力中のラウンドを求める。
// 的は保存済みの的を使う(詳細のオフラインの表示と同じ的で判定するため)。
export async function loadLocalRoundsList(): Promise<LocalRoundsList> {
  const log = await roundOpLog.loadAll();
  const faces = loadReferenceSnapshot<TargetFaceOption[]>("target-faces") ?? [];
  const inProgress: RoundListItem[] = [];
  const deleted = new Set<string>();
  for (const [roundId, { base, operations }] of log) {
    if (hasRoundDeletion(operations.map((entry) => entry.operation))) {
      deleted.add(roundId);
      continue;
    }
    const state = deriveRoundState(base, operations, faces);
    if (!state || !isRoundInProgress(state)) continue;
    inProgress.push({
      id: roundId,
      name: state.roundConfig.name,
      roundDate: state.roundConfig.roundDate,
      total: state.shots.reduce((sum, shot) => sum + shot.score_int, 0),
    });
  }
  return { inProgress, deleted };
}

// サーバーの一覧と、端末の入力中のラウンドおよび削除済みのラウンドを返す。
// 列は取得の前に読む。削除が確定済みのラウンドは、その後に始めた取得にどのページ・フィルタでも現れないため、取得の内容とは照合せず反映済みとする。
// 一覧の取得と、入力中と端末が保持するラウンドの一括の取得を並行に行い、両方が成功したときだけ成功とする。
// 一括の取得を端末の組へ反映した後に入力中のラウンドを求めるため、他端末の変更を端末の古いベースで隠さない。
// ユーザーの突き合わせは行わない。ベースと操作の列は端末でユーザーごとに隔離され、取得のユーザーとハブのユーザーが違う反映は端末へ保存されない。
// ページ・フィルタ・ソートの条件は、この関数の引数と`fetchRoundsList`のクエリに足す。
export async function loadRoundsList(
  supabase: SupabaseClient<Database>,
): Promise<FetchResult<LoadedRoundsList>> {
  const startedAt = Date.now();
  const log = await roundOpLog.loadAll();
  const deleted = new Set<string>();
  const confirmedDeletions: string[] = [];
  for (const [roundId, { operations }] of log) {
    if (!hasRoundDeletion(operations.map((entry) => entry.operation))) continue;
    deleted.add(roundId);
    const deletionConfirmed = operations.some(
      (entry) =>
        entry.operation.type === "round.disabled" &&
        entry.confirmedFields !== undefined,
    );
    if (deletionConfirmed) confirmedDeletions.push(roundId);
  }

  const retained = await roundOpLog.retainedRoundIds();
  const [list, details] = await Promise.all([
    fetchRoundsList(supabase),
    fetchRoundDetails(supabase, retained),
  ]);
  if (list.status !== "ok") return list;
  if (details.status !== "ok") return details;

  await commitRoundDetails(details.data, retained);
  const local = await loadLocalRoundsList();
  return {
    status: "ok",
    data: {
      items: list.data,
      inProgress: local.inProgress,
      deleted,
      confirmedDeletions,
      startedAt,
    },
  };
}
