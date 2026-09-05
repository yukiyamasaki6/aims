import { useCallback, useEffect, useRef, useState } from "react";

export type SyncStatus = "synced" | "syncing" | "error" | "pending";

export type SyncError = { key: string; label: string; message: string };

export type EnqueueInput = {
  key: string;
  label: string;
  run: () => Promise<{ error: string } | undefined>;
};

// 送信待ちの操作を1つのFIFOキューとして逐次処理する。同時に2件以上を
// 投げないことで、あるセルへの追加→更新→削除のような依存関係を明示的に
// 管理しなくても、投入順=実行順で自然に整合する（各操作はどれも
// 「絶対値をセットする」冪等な操作のため）。自動リトライ・永続化は
// 将来の別issueで追加する前提で、ここでは1回のみ試行する。
export function useSyncQueue() {
  const [queue, setQueue] = useState<EnqueueInput[]>([]);
  const [errorMap, setErrorMap] = useState<Map<string, SyncError>>(new Map());
  const processingRef = useRef(false);

  useEffect(() => {
    if (processingRef.current) return;
    const next = queue[0];
    if (!next) return;

    processingRef.current = true;
    // run()が例外を投げた場合（ネットワーク切断等の予期しない失敗）も
    // キューが永久にsyncingのまま止まらないよう、必ずcatchして
    // 通常の失敗と同じ扱いにする。
    next
      .run()
      .catch((e) => ({
        error:
          e instanceof Error ? e.message : "予期しないエラーが発生しました。",
      }))
      .then((result) => {
        setErrorMap((prev) => {
          const copy = new Map(prev);
          if (result?.error) {
            copy.set(next.key, {
              key: next.key,
              label: next.label,
              message: result.error,
            });
          } else {
            copy.delete(next.key);
          }
          return copy;
        });
        setQueue((prev) => prev.slice(1));
        processingRef.current = false;
      });
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
