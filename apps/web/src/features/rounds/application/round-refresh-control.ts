import { roundStreamId } from "../domain/sync-events";
import type { RefreshRequests } from "./refresh-requests";
import type { RoundBaseRefreshing } from "./round-base-refreshing";
import type { RoundRecordHub } from "./round-record-hub";

// 他の機能へ公開する、取り直しの操作。引数と戻り値は、ラウンドのIDの文字列、数、真偽だけで、ドメインの型は越えない。
export type RoundRefreshControl = {
  // 取り直しが要るラウンドを、要る理由の真偽とともに返す。いずれかの理由が真のラウンドだけを含む。
  // - open: 詳細を開く依頼が、結果を待っている。
  // - diverged: 送信の結果に、効かなかった操作か項目があった。
  // - overlay: 確定済みの操作を、ベースに重ねられなかった。
  // - openRequest は、そのラウンドの最後の開く依頼の番号で、依頼が届くたびに増える。番号が同じあいだは、新しい依頼は届いていない。
  refreshNeeds(): {
    rounds: readonly {
      roundId: string;
      open: boolean;
      diverged: boolean;
      overlay: boolean;
      openRequest: number;
    }[];
  };
  onRefreshNeeds(listener: () => void): void;
  // 的が足りない画面があるか(再取得を促す印が付いているか)。
  facesWanted(): boolean;
  // 入力中のラウンドと端末が保持するラウンドを、まとめて取得して端末の記録へ反映する。取得の失敗では拒否しない。
  refreshAll(): Promise<void>;
  // 1つのラウンドを取得して端末の記録へ反映する。次の契約に従う。
  // - 始めた時点で、そのラウンドの diverged の印を消す(取得の結果によらない)。
  // - 結果を受けるのは、始めた時点で記録にある開く依頼だけである。始めた後に出された開く依頼は結果を受けずに待ちとして残り、refreshNeeds はそのラウンドに open を返し続ける。
  // - 取得の失敗は結果として依頼の記録へ渡り、拒否しない。
  refreshRound(roundId: string): Promise<void>;
};

export function createRoundRefreshControl(deps: {
  hub: Pick<RoundRecordHub, "divergedStreams" | "subscribe">;
  requests: Pick<
    RefreshRequests,
    | "pendingOpens"
    | "watched"
    | "overlayNeeded"
    | "latestOpenRequest"
    | "facesWanted"
    | "subscribe"
  >;
  refresh: RoundBaseRefreshing;
}): RoundRefreshControl {
  const { hub, requests, refresh } = deps;

  function refreshNeeds() {
    const pending = new Set(requests.pendingOpens());
    const watched = new Set(requests.watched().map((entry) => entry.roundId));
    const rounds: {
      roundId: string;
      open: boolean;
      diverged: boolean;
      overlay: boolean;
      openRequest: number;
    }[] = [];
    for (const roundId of new Set([...pending, ...watched])) {
      const need = {
        roundId,
        open: pending.has(roundId),
        diverged: hub.divergedStreams().has(roundStreamId(roundId)),
        overlay: requests.overlayNeeded(roundId),
        openRequest: requests.latestOpenRequest(roundId),
      };
      if (need.open || need.diverged || need.overlay) rounds.push(need);
    }
    return { rounds };
  }

  return {
    refreshNeeds,
    onRefreshNeeds(listener) {
      requests.subscribe(listener);
      hub.subscribe(listener);
    },
    facesWanted: () => requests.facesWanted(),
    refreshAll: () => refresh.refreshAll(),
    refreshRound: (roundId) => refresh.refreshRound(roundId),
  };
}
