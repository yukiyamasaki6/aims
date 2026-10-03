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
  // 「同期失敗」の表示に使う操作名。
  label: string;
  // サーバーが確定した対象のrevision。送信の成功（重複の再送を含む）で1度だけ付く。
  ackedRevision?: number;
  operation: Op;
};

export type NewOpLogEntry<Op extends OpBase> = Omit<
  OpLogEntry<Op>,
  "seq" | "ackedRevision"
>;

export type RetireReason = "reflected";

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
};

export type OpPlanPorts<Op extends OpBase> = {
  // 前の操作と後の操作が、適用順で結果が変わる、または検証が順序に依存するとき真。
  conflicts: (previous: Op, next: Op) => boolean;
  // 同時に応答待ちにできる要求の分類。同じlaneは1本まで。
  laneOf: (operation: Op) => string;
  // 1つの要求にまとめてよいlaneと、その上限。無ければ1件だけの要求にする。
  batchLimitOf: (lane: string) => number;
};

// 送信が成功したときは、要求の操作と同じ順の、確定したrevisionを返す。
export type SendOutcome =
  | { ok: true; revisions: number[] }
  | { ok: false; failure: NonNullable<BatchResult> };

export type OpFlight<Op extends OpBase> = {
  lane: string;
  entries: Array<{ eventId: string; operation: Op }>;
};
