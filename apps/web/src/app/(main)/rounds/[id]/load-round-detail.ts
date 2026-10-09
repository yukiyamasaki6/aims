import type { SupabaseClient } from "@supabase/supabase-js";
import { FALLBACK_WAIT_MS } from "@/features/fetch-result/fetch-content";
import {
  FETCH_ERROR_MESSAGE,
  type FetchResult,
} from "@/features/fetch-result/fetch-result";
import type { Database } from "@/types/supabase";
import { loadReferenceSnapshot } from "../_shared/reference-snapshot";
import {
  hasRoundDeletion,
  type RoundGroup,
  roundOpLog,
} from "../_shared/round-op-log";
import type { TargetFaceOption } from "./distance-config-row";
import { fetchRoundDetail, fetchTargetFaces } from "./fetch-round-detail";
import { roundStreamRules } from "./round-base";
import {
  type RoundTables,
  roundTablesFromCreated,
  roundTablesFromServer,
} from "./round-tables";

export type LoadedRound = {
  // 状態を求める最初のベース。取得した状態、端末のベース、または確定していない作成の操作が表す状態。
  // 画面の状態は、送信器の組のベースと操作の列から求める(これは組にベースが無い間だけ使う)。
  base: RoundTables;
  // 取り込む組。取得したときは、取得のベースに反映済みと確かめた操作を含まない。
  group: RoundGroup;
  // そろった的の一覧全体(取得に成功した一覧、または最後に取得に成功した一覧の保存分)。
  targetFaces: TargetFaceOption[];
  // 確定していない作成のeventId。あるとき、基準は端末の作成の操作である。
  pendingCreationEventId: string | null;
  // 取得できなかった(または`FALLBACK_WAIT_MS`内に終わらなかった)ため、端末のベースで開いたときは"local"。
  source: "server" | "local";
  // `source`が"local"で、取得が`FALLBACK_WAIT_MS`を超えて続いているとき、その完了(取得できたときは反映済み)で解決する。
  pendingServer?: Promise<FetchResult<LoadedRoundDetail>>;
};

// deleted: ラウンドの削除が列にあるため、取得した状態を表示せず一覧へ戻る。
export type LoadedRoundDetail =
  | { deleted: true }
  | ({ deleted: false } & LoadedRound);

type LoadOptions = {
  // 偽のときは、端末のベースで開かず、取得の結果だけを返す(開いた詳細の取り直し)。
  localFallback?: boolean;
};

const DELETED: FetchResult<LoadedRoundDetail> = {
  status: "ok",
  data: { deleted: true },
};

// サーバーの状態を取得して端末の組へ反映し、結果の組を返す。取得できなければ、そのまま返す。
// 反映済みの判定は、確定のrevisionと取得のrevisionの比較(round-base.ts)で、取得を端末の組へ反映する中で行う。
async function loadFromServer(
  supabase: SupabaseClient<Database>,
  roundId: string,
): Promise<FetchResult<LoadedRoundDetail>> {
  const fetched = await fetchRoundDetail(supabase, roundId);
  if (fetched.status !== "ok") return fetched;

  const { revisions, roundConfig, status, distances, shots, targetFaces } =
    fetched.data;
  const base = roundTablesFromServer({ roundConfig, status, distances, shots });
  const group = await roundOpLog.commit(
    roundId,
    { tables: base, revisions },
    fetched.data.startedAt,
    fetched.data.userId,
  );
  // 取得の間に追記された削除も、取得した状態を表示せずに離れる。
  if (hasRoundDeletion(group.entries.map((entry) => entry.operation))) {
    return DELETED;
  }
  return {
    status: "ok",
    data: {
      deleted: false,
      base,
      group,
      targetFaces,
      pendingCreationEventId: null,
      source: "server",
    },
  };
}

// `ms`の間に`promise`が終わらなければ"timeout"を返す。
async function withinWait<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
}

// 端末の組で開くかを決め、端末のベースがあるときは開くための材料を返す。
// 的の一覧の保存分が無いときは開かない(サーバーの取得を待つ)。
function localRound(group: RoundGroup): LoadedRound | null {
  const stored = group.base?.base;
  if (!stored) return null;
  if (!roundStreamRules.keeps(stored, group.entries)) return null;
  const targetFaces = loadReferenceSnapshot<TargetFaceOption[]>("target-faces");
  if (targetFaces === null) return null;
  return {
    base: stored.tables,
    group,
    targetFaces,
    pendingCreationEventId: null,
    source: "local",
  };
}

// 表示の材料を返す。サーバーの状態は取得して端末の組へ反映し、画面はその組から状態を求める。
// 通信できないとき(オフライン、取得の失敗、`FALLBACK_WAIT_MS`を超えた取得)は、端末が保持するラウンドを、端末のベースで開く。
// 的の一覧がそろわないとき(取得できず、保存分も無い)は、内容を返さず、取得の結果(`offline`か`error`)を返す。
export async function loadRoundDetail(
  supabase: SupabaseClient<Database>,
  roundId: string,
  { localFallback = true }: LoadOptions = {},
): Promise<FetchResult<LoadedRoundDetail>> {
  const first = await roundOpLog.load(roundId);
  // 削除は、取得せずに離れる。削除以降の操作は反映されないため、取得した状態を表示する意味がない。
  if (hasRoundDeletion(first.entries.map((entry) => entry.operation))) {
    return DELETED;
  }
  // 確定していない作成があれば、ラウンドは取得せずに作成の操作を基準にする。作成の後続は確定まで送られないため、サーバーの状態は作成の操作と一致する。
  for (const entry of first.entries) {
    const { operation } = entry;
    if (operation.type !== "round.created") continue;
    if (entry.ackedRevision !== undefined) continue;
    const faces = await fetchTargetFaces(supabase);
    if (faces.status !== "ok") return faces;
    return {
      status: "ok",
      data: {
        deleted: false,
        base: roundTablesFromCreated(operation),
        group: first,
        targetFaces: faces.data,
        pendingCreationEventId: operation.eventId,
        source: "server",
      },
    };
  }

  // 取得は拒否しない。画面が「読み込み中」に固定されないよう、失敗はerrorにする。
  const server = loadFromServer(supabase, roundId).catch(
    (): FetchResult<LoadedRoundDetail> => ({
      status: "error",
      message: FETCH_ERROR_MESSAGE,
    }),
  );
  const local = localFallback ? localRound(first) : null;
  if (!local) return server;

  const raced = await withinWait(server, FALLBACK_WAIT_MS);
  if (raced === "timeout") {
    return {
      status: "ok",
      data: { deleted: false, ...local, pendingServer: server },
    };
  }
  if (raced.status === "ok" || raced.status === "not-found") return raced;
  return { status: "ok", data: { deleted: false, ...local } };
}
