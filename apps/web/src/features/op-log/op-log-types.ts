import type { BatchResult } from "./sync-types";

export type OpBase = { eventId: string };

// 端末の操作の列の要素。保存後は`ackedRevision`の付与以外で変わらない。
export type OpLogEntry<Op extends OpBase> = {
  // 列の順序。保存時にIndexedDBが採番する（時計に依存しない）。
  seq: number;
  // サーバーの冪等性キー。operation.eventIdと一致する。
  eventId: string;
  // 順序を保つ単位。ラウンド詳細画面の操作は`round:<roundId>`。
  streamId: string;
  userId: string | null;
  // サーバーが確定した対象のrevision。送信の成功（重複の再送を含む）で1度だけ付く。
  ackedRevision?: number;
  // 確定した操作が効いたか。未定義は効いたものとして扱う。
  ackedApplied?: boolean;
  // 項目に分ける操作で、効いた項目。未定義は全項目が効いたものとして扱う。
  ackedFields?: string[];
  operation: Op;
};

export type NewOpLogEntry<Op extends OpBase> = Omit<
  OpLogEntry<Op>,
  "seq" | "ackedRevision" | "ackedApplied" | "ackedFields"
>;

// 取得して得た、列の対象の状態(ベース)。`base`がnullは、サーバーに無い(削除された)ことの印。
// `startedAt`は取得の開始時刻で、古い取得の結果で新しい保存を上書きしないために使う。
export type StreamBase<Base> = { startedAt: number; base: Base | null };

// ベースと操作の列の組。ベースは取得されていなければundefined。
export type StreamGroup<Op extends OpBase, Base> = {
  base: StreamBase<Base> | undefined;
  entries: OpLogEntry<Op>[];
};

// 反映済みと保持の判定が使う、列の1件の項目。
export type StreamEntry<Op extends OpBase> = Pick<
  OpLogEntry<Op>,
  "operation" | "ackedRevision" | "ackedApplied" | "ackedFields"
>;

// 列の対象ごとに決まる規則。
export type StreamRules<Op extends OpBase, Base> = {
  // 確定した操作が、ベースに反映済みか。ベースがnullのときは、確定済みの操作は全て反映済み。
  reflects: (base: Base | null, entry: StreamEntry<Op>) => boolean;
  // ベースに、反映済みでない操作を重ねた状態を端末に保持するか。未送信の操作が残るときは真を返す(保持しない組は丸ごと消すため)。
  keeps: (base: Base, entries: StreamEntry<Op>[]) => boolean;
};

// ineffectiveは効かなかった操作、discardedは認可・契約で拒否された操作。
export type RetireReason = "reflected" | "ineffective" | "discarded";

// 送信器のメモリ上の、操作ごとの状態。
export type OpStatus =
  | "persisting"
  | "queued"
  | "inflight"
  | "backoff"
  | "held"
  | "acked";

// 送信の計画に渡す、列の順に並んだ操作の状態。
export type PlanItem<Op extends OpBase> = {
  eventId: string;
  operation: Op;
  status: OpStatus;
  // 拒否の切り分けで、単独の要求にする操作。
  solo: boolean;
  // いまこのタブが送ってよい操作か。偽でも、未確定であれば衝突する後続を止める。
  sendable: boolean;
};

export type OpPlanPorts<Op extends OpBase> = {
  // 前の操作と後の操作が、適用順で結果が変わる、または検証が順序に依存するとき真。
  conflicts: (previous: Op, next: Op) => boolean;
  // 同時に応答待ちにできる要求の分類。同じlaneは1本まで。
  laneOf: (operation: Op) => string;
  // 1つの要求にまとめてよいlaneと、その上限。無ければ1件だけの要求にする。
  batchLimitOf: (lane: string) => number;
};

// 操作ごとの、サーバーの判定結果。効かなかった操作のrevisionはnull。
export type OpResult = {
  revision: number | null;
  applied: boolean;
  appliedFields: string[] | null;
  rejectedFields: { field: string; reason: string }[];
  reason: string | null;
};

// 送信が成功したときは、要求の操作と同じ順の判定結果を返す。
export type SendOutcome =
  | { ok: true; results: OpResult[] }
  | { ok: false; failure: NonNullable<BatchResult> };

export type OpFlight<Op extends OpBase> = {
  lane: string;
  entries: Array<{ eventId: string; operation: Op }>;
};
