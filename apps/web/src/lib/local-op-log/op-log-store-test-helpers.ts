import type { OpBase, OpLogStore, StreamGroup } from "./contract/op-log-store";

// 現在のユーザーの1つの列の組を、`loadAll`の結果から取る。ベースも操作も無い列は空の組にする。
export async function loadStreamGroup<Op extends OpBase, Base>(
  store: OpLogStore<Op, Base>,
  streamId: string,
  userId: string | null,
): Promise<StreamGroup<Op, Base>> {
  const all = await store.loadAll(userId);
  return all.get(streamId) ?? { base: undefined, entries: [] };
}
