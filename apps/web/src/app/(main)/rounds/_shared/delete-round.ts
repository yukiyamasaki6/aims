import type { RoundsStore } from "@/features/rounds/application/rounds-store";

// 一覧と詳細の確認の後に呼ぶ、ラウンドの削除。操作の列へ`round.disabled`を積む。
// 保存の試みが終わると解決し、拒否しない。送信は同期が行い、完了は待たない。
export function deleteRound(
  store: RoundsStore,
  roundId: string,
): Promise<void> {
  return store.append(roundId, {
    type: "round.disabled",
    eventId: crypto.randomUUID(),
    roundId,
  });
}
