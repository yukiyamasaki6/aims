import { roundOpLog } from "./round-op-log";

// 一覧と詳細の確認の後に呼ぶ、ラウンドの削除。操作の列へ`round.disabled`を積む。
// 保存の試みが終わると解決し、拒否しない。送信は常駐の送信器が行い、完了は待たない。
export function deleteRound(roundId: string): Promise<void> {
  return roundOpLog.round(roundId).append({
    type: "round.disabled",
    eventId: crypto.randomUUID(),
    roundId,
  });
}
