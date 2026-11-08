import type { IdentityReader, SignInChanges } from "@/features/auth";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import type { RoundSync } from "./round-sync";

// 画面が見える状態になったことの通知。
export type Visibility = {
  onVisible(listener: () => void): () => void;
};

// 契機の受け取り。受けた契機を規則で同期の手続きの操作に変える。
type SyncTriggers = {
  // 戻り値は、止める関数。
  start(): () => void;
};

export function createSyncTriggers(deps: {
  identityReader: IdentityReader;
  changes: SignInChanges;
  visibility: Visibility;
  connectivity: Connectivity;
  sync: RoundSync;
}): SyncTriggers {
  const { identityReader, changes, visibility, connectivity, sync } = deps;

  return {
    start() {
      sync.start(identityReader.read());
      const stops = [
        changes.subscribe((change) => sync.signInChanged(change)),
        // 通信の復帰と画面が見える状態は、どちらも常駐の取得の契機である。
        connectivity.onOnline(() => sync.resume()),
        visibility.onVisible(() => sync.resume()),
      ];
      return () => {
        for (const stop of stops) stop();
        sync.stop();
      };
    },
  };
}
