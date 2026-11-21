import type { UniqueIds } from "./unique-ids";

// 払い出し済みのIDを観測できる、連番のID。
// next()は`<prefix>-<n>`(nは1から)を返す。
export function createFakeUniqueIds(options: { prefix?: string } = {}) {
  const prefix = options.prefix ?? "id";
  const issuedIds: string[] = [];
  const ids: UniqueIds = {
    next: () => {
      const id = `${prefix}-${issuedIds.length + 1}`;
      issuedIds.push(id);
      return id;
    },
  };
  return { ids, issued: () => [...issuedIds] };
}
