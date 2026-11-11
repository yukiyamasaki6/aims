import type { FetchResult, FetchView } from "./fetch-status";
import type { RecordBase } from "./round-base";
import type { AppliedOperation } from "./round-op-apply";
import type { RoundTables } from "./round-tables";
import { originOf } from "./round-view";
import type { SyncOperation } from "./sync-events";
import type { TargetFaceOption } from "./target-face";

// 詳細を開く判断の入力。
export type OpeningInput = {
  record: {
    base: RecordBase | undefined;
    operations: readonly AppliedOperation[];
  };
  // 購読の最初の判定で、記録に削除の操作があったか。
  deletedAtStart: boolean;
  // 端末に保存済みの的の一覧。無ければnull(空配列は保存済み)。
  savedFaces: TargetFaceOption[] | null;
  // ラウンドの取得の結果。始まっていない、または結果待ちはnull。
  roundFetch: FetchResult<null> | null;
  // 的の取得の結果。始まっていない、または結果待ちはnull。
  facesFetch: FetchResult<TargetFaceOption[]> | null;
};

// 開く判断が準備完了のときの値。
export type OpeningReady = {
  origin: RoundTables;
  savedFaces: TargetFaceOption[];
};

// 詳細を開くときの判断。記録(ベースと操作)を真とし、取得の結果は起点が無いとき、的が無いときにだけ見る。
// 戻りのokは、画面を導く起点のテーブルと、保存済みの的。
export function roundOpening(input: OpeningInput): FetchView<OpeningReady> {
  const { record, savedFaces, roundFetch, facesFetch } = input;
  // 削除済み(メモリのベースがnull)、または最初の判定で削除の操作があった。
  if (record.base?.base === null || input.deletedAtStart) {
    return { status: "not-found" };
  }
  const origin = originOf(record);
  if (origin) {
    if (savedFaces !== null) {
      return { status: "ok", data: { origin, savedFaces } };
    }
    return failureOrLoading(facesFetch);
  }
  // 起点が無い間は、ラウンドの取得の結果で決める。結果が記録に入らない異常は、結果待ちと同じに扱う。
  return failureOrLoading(roundFetch);
}

function failureOrLoading<T>(result: FetchResult<T> | null): FetchView<never> {
  if (result?.status === "offline") return { status: "offline" };
  if (result?.status === "error") return result;
  return { status: "loading" };
}

// サーバーに無いか。記録にベースが無く(`undefined`)、起点が確定していない作成の操作だけである。
// 未確定の作成だけが起点のラウンドは、取得で返らなくても削除と扱わない。操作もベースも無い記録(端末に一度も無いID)は、サーバーに無いと判断しない。
export function isUnknownToServer(record: {
  base: RecordBase | undefined;
  items: readonly { operation: SyncOperation; ackedRevision?: number }[];
}): boolean {
  if (record.base !== undefined) return false;
  return record.items.some(
    (item) =>
      item.operation.type === "round.created" &&
      item.ackedRevision === undefined,
  );
}
