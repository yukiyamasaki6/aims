import { roundStreamId } from "../domain/sync-events";
import type { RoundBaseRefreshing } from "./round-base-refreshing";
import type { RoundRecordHub } from "./round-record-hub";
import type { RoundWindow } from "./round-window";

// 他の機能へ公開する、取り直しの操作。引数と戻り値は、ラウンドのIDの文字列と真偽だけで、ドメインの型は越えない。
export type RoundRefreshControl = {
  // 取り直しが要るラウンドを返す。準備完了の詳細のうち、送信の結果に効かなかった操作か項目があった(diverged)ラウンドだけを含む。
  refreshNeeds(): {
    rounds: readonly {
      roundId: string;
      diverged: boolean;
    }[];
  };
  onRefreshNeeds(listener: () => void): void;
  // 入力中のラウンドと端末が保持するラウンドを、まとめて取得して端末の記録へ反映する。取得の失敗では拒否しない。
  refreshAll(): Promise<void>;
  // 1つのラウンドを取得して端末の記録へ反映する。始めた時点で、そのラウンドの diverged の印を消す(取得の結果によらない)。取得の失敗では拒否しない。
  refreshRound(roundId: string): Promise<void>;
};

export function createRoundRefreshControl(deps: {
  hub: Pick<RoundRecordHub, "divergedStreams" | "subscribe">;
  roundWindow: Pick<RoundWindow, "readyRounds" | "onReadyChange">;
  refresh: RoundBaseRefreshing;
}): RoundRefreshControl {
  const { hub, roundWindow, refresh } = deps;

  function refreshNeeds() {
    const rounds = roundWindow
      .readyRounds()
      .map(({ roundId }) => ({
        roundId,
        diverged: hub.divergedStreams().has(roundStreamId(roundId)),
      }))
      .filter((need) => need.diverged);
    return { rounds };
  }

  return {
    refreshNeeds,
    onRefreshNeeds(listener) {
      roundWindow.onReadyChange(listener);
      hub.subscribe(listener);
    },
    refreshAll: () => refresh.refreshAll(),
    // 取得の結果は捨てる(結果を使うのは窓口)。
    refreshRound: async (roundId) => {
      await refresh.refreshRound(roundId);
    },
  };
}
