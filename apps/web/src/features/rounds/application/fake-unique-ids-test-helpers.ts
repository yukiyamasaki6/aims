import type { UniqueIds } from "./unique-ids";

// 払い出し済みのIDを観測できる、連番のID。
// next()は`<prefix>-<n>`(nは1から)を返す。randomBytesは注入の関数で、既定は0埋め。
export function createFakeUniqueIds(
  options: {
    prefix?: string;
    randomBytes?: (length: number) => Uint8Array;
  } = {},
) {
  const prefix = options.prefix ?? "id";
  const issuedIds: string[] = [];
  const ids: UniqueIds = {
    next: () => {
      const id = `${prefix}-${issuedIds.length + 1}`;
      issuedIds.push(id);
      return id;
    },
    randomBytes: options.randomBytes ?? ((length) => new Uint8Array(length)),
  };
  return { ids, issued: () => [...issuedIds] };
}
