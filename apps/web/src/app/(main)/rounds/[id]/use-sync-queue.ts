import { useCallback, useRef, useState } from "react";

export type SyncStatus = "synced" | "syncing" | "error" | "pending";

export type SyncError = { key: string; label: string; message: string };

export type EnqueueInput = {
  key: string;
  label: string;
  run: () => Promise<{ error: string } | undefined>;
  // 別のkeyの操作が先に完了している必要がある場合に指定する
  // （例: まだ作成中の距離へのスコア記録は、その距離のdistance:{id}
  // キーの完了を待つ必要がある）。指定したkeyに何も走っていなければ
  // 待ち時間なしで即座に実行される。
  dependsOnKey?: string;
};

function runSafely(item: EnqueueInput) {
  // run()が例外を投げた場合（ネットワーク切断等の予期しない失敗）も
  // 永久にsyncingのまま止まらないよう、必ずcatchして通常の失敗と
  // 同じ扱いにする。
  return item.run().catch((e) => ({
    error: e instanceof Error ? e.message : "予期しないエラーが発生しました。",
  }));
}

// 送信待ちの操作をkeyごとに独立した列として扱う。異なるkeyの操作は
// 互いを待たずに即座に並行実行され、同じkeyへの操作だけが投入順を守って
// 直列に実行される（同じマスへの連続上書きが後勝ちで正しく反映されるため）。
// これにより、無関係な操作（別々のマスへのスコア記録等）が1本の
// キューで頭を塞ぎ合い、通信本数分だけ同期完了が遅くなる問題を避ける。
// dependsOnKeyを使うことで、新規distance作成のように他の操作が
// 参照しうる操作だけ、必要な範囲で完了を待たせられる。
// 自動リトライ・永続化は将来の別issueで追加する前提で、ここでは各操作を
// 1回のみ試行する。
export function useSyncQueue() {
  const [errorMap, setErrorMap] = useState<Map<string, SyncError>>(new Map());
  const [pendingCount, setPendingCount] = useState(0);
  const tailsRef = useRef<Map<string, Promise<unknown>>>(new Map());

  const enqueue = useCallback((input: EnqueueInput) => {
    // 新しい楽観値が古い失敗を上書きするため、同じkeyへの再送信は
    // 直前の失敗表示を即座にクリアする（この試行の結果を待たない）。
    setErrorMap((prev) => {
      if (!prev.has(input.key)) return prev;
      const copy = new Map(prev);
      copy.delete(input.key);
      return copy;
    });
    setPendingCount((n) => n + 1);

    const ownTail = tailsRef.current.get(input.key) ?? Promise.resolve();
    const depTail = input.dependsOnKey
      ? (tailsRef.current.get(input.dependsOnKey) ?? Promise.resolve())
      : Promise.resolve();

    const runPromise = Promise.all([ownTail, depTail]).then(() =>
      runSafely(input),
    );
    tailsRef.current.set(input.key, runPromise);

    runPromise.then((result) => {
      setErrorMap((prev) => {
        const copy = new Map(prev);
        if (result?.error) {
          copy.set(input.key, {
            key: input.key,
            label: input.label,
            message: result.error,
          });
        } else {
          copy.delete(input.key);
        }
        return copy;
      });
      setPendingCount((n) => n - 1);
    });
  }, []);

  const errorFor = useCallback(
    (key: string) => errorMap.get(key)?.message,
    [errorMap],
  );

  const status: SyncStatus =
    pendingCount > 0 ? "syncing" : errorMap.size > 0 ? "error" : "synced";

  return {
    status,
    errors: Array.from(errorMap.values()),
    errorFor,
    enqueue,
  };
}
