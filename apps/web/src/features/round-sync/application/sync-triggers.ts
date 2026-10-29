import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import {
  reactionTo,
  type SignInChange,
  startsRefresh,
} from "../domain/sync-trigger";
import type { RoundSync } from "./round-sync";

// 認証の通知。initialUserIdは、端末の識別情報の利用者。
export type SignInSignals = {
  initialUserId(): string | null;
  subscribe(listener: (change: SignInChange) => void): () => void;
};

// 画面が見える状態になったことの通知。
export type Visibility = {
  onVisible(listener: () => void): () => void;
};

// 契機の受け取り。受けた契機を規則で同期の手続きの操作に変える。
export function createSyncTriggers(deps: {
  signals: SignInSignals;
  visibility: Visibility;
  connectivity: Connectivity;
  sync: RoundSync;
}) {
  const { signals, visibility, connectivity, sync } = deps;

  function handleSignIn(change: SignInChange) {
    const reaction = reactionTo(change, (id) => sync.matchUser(id));
    if (reaction.type === "switch-user") sync.switchUser(reaction.userId);
    if (reaction.type === "resume") sync.resume();
    if (startsRefresh(change)) sync.refreshAll("resident");
  }

  return {
    // 戻り値は、止める関数。
    start(): () => void {
      sync.start(signals.initialUserId());
      const stops = [
        signals.subscribe(handleSignIn),
        connectivity.onOnline(() => sync.online()),
        connectivity.onOffline(() => sync.offline()),
        visibility.onVisible(() => sync.visible()),
      ];
      return () => {
        for (const stop of stops) stop();
        sync.stop();
      };
    },
  };
}
