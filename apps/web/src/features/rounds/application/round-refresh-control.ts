import { roundStreamId } from "../domain/sync-events";
import type { RefreshRequests } from "./refresh-requests";
import type { RoundBaseRefreshing } from "./round-base-refreshing";
import type { RoundRecordHub } from "./round-record-hub";

// 取り直しの理由を、優先の順に並べた唯一の定義。リテラル和型はここから導く。
// open: 開いたとき、stale: 端末のベースで開いたまま、diverged: 効かなかった結果を受けた、overlay: 確定済みの操作をベースに重ねられなかった。
const REFRESH_NEED_REASONS = ["open", "stale", "diverged", "overlay"] as const;
type RefreshNeedReason = (typeof REFRESH_NEED_REASONS)[number];

// 他の機能へ公開する、取り直しの操作。引数と戻り値は、ラウンドのIDの文字列、理由と結果の種類の文字列、数、真偽だけで、ドメインの型は越えない。
export type RoundRefreshControl = {
  // 取り直しが要るかを、ラウンドごとの理由で返す。理由は次の契約に従う。
  // - 理由はラウンドごとに1つで、当たるもののうち open、stale、diverged、overlay の順に先のものを返す。
  //   open: 詳細を開く依頼が、結果を待っている。
  //   stale: 端末のベースで開いた詳細が、まだ取得に成功していない。
  //   diverged: 送信の結果に、効かなかった操作か項目があった。
  //   overlay: 確定済みの操作を、ベースに重ねられなかった。
  // - reasons は、当たる全ての理由を同じ優先の順で並べる。reason は reasons の先頭である。
  // - 先の理由が無くなると、残る理由のうち次のものを返す(例: 開く依頼が結果を受けると、端末のベースで開いた詳細の理由は stale になる)。
  // - openRequest は、依頼が届くたびに増える番号で、停止でも数え直さない。番号が同じあいだは、新しい依頼は届いていない。
  refreshNeeds(): {
    rounds: readonly {
      roundId: string;
      reason: RefreshNeedReason;
      reasons: readonly RefreshNeedReason[];
      // 理由が open のときだけ付く。そのラウンドの最後の開く依頼の番号。
      openRequest?: number;
    }[];
  };
  onRefreshNeeds(listener: () => void): () => void;
  // 入力中のラウンドと端末が保持するラウンドを、まとめて取得して端末の記録へ反映する。失敗しても拒否しない。
  refreshAll(): Promise<void>;
  // 1つのラウンドを取得して端末の記録へ反映する。次の契約に従う。
  // - 始めた時点で、そのラウンドの diverged の印を消す(取得の結果によらない)。
  // - 結果を受けるのは、始めた時点で記録にある開く依頼だけである。始めた後に出された開く依頼は結果を受けずに待ちとして残り、refreshNeeds はそのラウンドに open を返し続ける。
  // - 戻り値: ok は反映した、gone はサーバーに無いか、記録に削除がある、failed は取得か反映に失敗した。
  refreshRound(roundId: string): Promise<"ok" | "gone" | "failed">;
  // 取り直しの依頼を初期化する。
  reset(): void;
};

// 当たる全ての理由を、優先の順に並べる。主の理由は先頭。
function reasonsOf(
  applies: Record<RefreshNeedReason, boolean>,
): RefreshNeedReason[] {
  return REFRESH_NEED_REASONS.filter((reason) => applies[reason]);
}

export function createRoundRefreshControl(deps: {
  hub: Pick<RoundRecordHub, "divergedStreams" | "subscribe">;
  requests: Pick<
    RefreshRequests,
    | "pendingOpens"
    | "watched"
    | "outcomeOf"
    | "overlayNeeded"
    | "latestOpenRequest"
    | "reset"
    | "subscribe"
  >;
  refresh: RoundBaseRefreshing;
}): RoundRefreshControl {
  const { hub, requests, refresh } = deps;

  function refreshNeeds() {
    const pending = new Set(requests.pendingOpens());
    const watched = new Map(
      requests.watched().map((entry) => [entry.roundId, entry.local]),
    );
    const rounds: {
      roundId: string;
      reason: RefreshNeedReason;
      reasons: RefreshNeedReason[];
      openRequest?: number;
    }[] = [];
    for (const roundId of new Set([...pending, ...watched.keys()])) {
      const reasons = reasonsOf({
        open: pending.has(roundId),
        stale:
          watched.get(roundId) === true && requests.outcomeOf(roundId) !== "ok",
        diverged: hub.divergedStreams().has(roundStreamId(roundId)),
        overlay: requests.overlayNeeded(roundId),
      });
      if (reasons.length === 0) continue;
      const need = { roundId, reason: reasons[0], reasons };
      rounds.push(
        need.reason === "open"
          ? { ...need, openRequest: requests.latestOpenRequest(roundId) }
          : need,
      );
    }
    return { rounds };
  }

  return {
    refreshNeeds,
    onRefreshNeeds(listener) {
      const stopRequests = requests.subscribe(listener);
      const stopHub = hub.subscribe(listener);
      return () => {
        stopRequests();
        stopHub();
      };
    },
    refreshAll: () => refresh.refreshAll(),
    refreshRound: (roundId) => refresh.refreshRound(roundId),
    reset: () => requests.reset(),
  };
}
