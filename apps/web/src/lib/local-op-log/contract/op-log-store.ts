// 操作の列の、端末への保存。
// 例外: 保存先が使えないときは投げることがある。手続きは、追記ではメモリの列で続け、読み込みでは空とし、反映ではこのタブだけに反映する。

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

// 列の対象ごとに決まる規則。保存の中で、ベースの反映と保持を決めるために使う。
export type StreamRules<Op extends OpBase, Base> = {
  // 確定した操作が、ベースに反映済みか。ベースがnullのときは、確定済みの操作は全て反映済み。
  reflects: (base: Base | null, entry: StreamEntry<Op>) => boolean;
  // ベースに、反映済みでない操作を重ねた状態を端末に保持するか。未送信の操作が残るときは真を返す(保持しない組は丸ごと消すため)。
  keeps: (base: Base, entries: StreamEntry<Op>[]) => boolean;
  // 取り込もうとするベースが、今のベースより古い状態か。取得の開始時刻では、同時に始まった取得のどちらが新しい状態を返すかを決められないため、サーバーが付けたrevisionで比べる。
  isOlder: (current: Base, incoming: Base) => boolean;
};

// ineffectiveは効かなかった操作、discardedは認可・契約で拒否された操作。
type RetireReason = "reflected" | "ineffective" | "discarded";

export type OpLogStore<Op extends OpBase, Base> = {
  // 呼び出された順に保存し、採番された`seq`を返す。`base`(記録のベース)が保存済みより新しく、保持の規則に当たるときは、同じトランザクションで保存する。
  append: (
    entry: NewOpLogEntry<Op>,
    base?: StreamBase<Base>,
  ) => Promise<number>;
  // 現在のユーザーのベースと操作を、1つのトランザクションで返す(操作は`seq`順)。他ユーザーのものは保存したまま読まない。
  loadStream: (
    streamId: string,
    userId: string | null,
  ) => Promise<StreamGroup<Op, Base>>;
  // 現在のユーザーの全ての列の組を、`streamId`ごとに返す。ベースか操作を持つ列だけ。他ユーザーのものは保存したまま読まない。
  loadAll: (
    userId: string | null,
  ) => Promise<Map<string, StreamGroup<Op, Base>>>;
  // 取得したベースを、1つのトランザクションで反映する。保存済みより`startedAt`が古い取得は何も変えず、保存済みの組を返す。
  // 新しければ、ベースに反映済みの操作を消し、保持の規則に当たれば(`base`がnullなら削除の印として)保存する。
  // 当たらなければ、組を丸ごと消す(`keeps`は未送信があれば真を返すため、未送信は消えない)。
  commit: (
    streamId: string,
    userId: string | null,
    base: Base | null,
    startedAt: number,
  ) => Promise<StreamGroup<Op, Base>>;
  // 確定の結果を1度だけ付ける。列に無い、または付いている操作には何もしない。操作は消さない。
  ack: (
    eventId: string,
    revision: number | null,
    applied: boolean,
    appliedFields: string[] | null,
  ) => Promise<void>;
  // 列から外す。
  retire: (eventIds: string[], reason: RetireReason) => Promise<void>;
  close: () => Promise<void>;
};
