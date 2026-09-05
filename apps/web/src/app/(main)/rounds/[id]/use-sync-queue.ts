import { useCallback, useEffect, useRef, useState } from "react";

export type SyncStatus = "synced" | "syncing" | "error" | "pending";

export type SyncError = { key: string; label: string; message: string };

export type EnqueueInput = {
  key: string;
  label: string;
  run: () => Promise<{ error: string } | undefined>;
  // trueの操作（新規distance作成等、他の操作から参照されうるIDを新しく
  // 生成する操作）は、同じバッチ内の他の操作より必ず先に完了させる。
  isCreate?: boolean;
};

function runSafely(item: EnqueueInput) {
  // run()が例外を投げた場合（ネットワーク切断等の予期しない失敗）も
  // バッチが永久にsyncingのまま止まらないよう、必ずcatchして
  // 通常の失敗と同じ扱いにする。
  return item
    .run()
    .catch((e) => ({
      error:
        e instanceof Error ? e.message : "予期しないエラーが発生しました。",
    }))
    .then((result) => ({ item, result }));
}

// 送信待ちの操作を1つのキューとして扱うが、1件ずつ逆次送信すると本数分の
// 通信往復が積み上がって同期完了までの体感速度が悪化するため、処理を始める
// 時点で溜まっている分をバッチとしてまとめて並列送信する。バッチの処理中に
// 追加された分は次のバッチとして扱う（バッチ間の順序は保つ）。
// 新規distance作成（isCreate）だけは、同じバッチ内の他の操作（その
// distanceへのスコア記録・更新等）より先に完了させる必要があるため、
// バッチ内で2段階（作成→その他）に分けて実行する。
// 自動リトライ・永続化は将来の別issueで追加する前提で、ここでは各操作を
// 1回のみ試行する。
export function useSyncQueue() {
  const [queue, setQueue] = useState<EnqueueInput[]>([]);
  const [errorMap, setErrorMap] = useState<Map<string, SyncError>>(new Map());
  const processingRef = useRef(false);

  useEffect(() => {
    if (processingRef.current) return;
    if (queue.length === 0) return;

    processingRef.current = true;
    const batch = queue;
    const creates = batch.filter((item) => item.isCreate);
    const rest = batch.filter((item) => !item.isCreate);

    (async () => {
      const settled = [
        ...(creates.length > 0
          ? await Promise.all(creates.map(runSafely))
          : []),
        ...(await Promise.all(rest.map(runSafely))),
      ];

      setErrorMap((prev) => {
        const copy = new Map(prev);
        for (const { item, result } of settled) {
          if (result?.error) {
            copy.set(item.key, {
              key: item.key,
              label: item.label,
              message: result.error,
            });
          } else {
            copy.delete(item.key);
          }
        }
        return copy;
      });
      setQueue((prev) => prev.slice(batch.length));
      processingRef.current = false;
    })();
  }, [queue]);

  const enqueue = useCallback((input: EnqueueInput) => {
    // 新しい楽観値が古い失敗を上書きするため、同じkeyへの再送信は
    // 直前の失敗表示を即座にクリアする（この試行の結果を待たない）。
    setErrorMap((prev) => {
      if (!prev.has(input.key)) return prev;
      const copy = new Map(prev);
      copy.delete(input.key);
      return copy;
    });
    setQueue((prev) => [...prev, input]);
  }, []);

  const errorFor = useCallback(
    (key: string) => errorMap.get(key)?.message,
    [errorMap],
  );

  const status: SyncStatus =
    queue.length > 0 ? "syncing" : errorMap.size > 0 ? "error" : "synced";

  return {
    status,
    errors: Array.from(errorMap.values()),
    errorFor,
    enqueue,
  };
}
