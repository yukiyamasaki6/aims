"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";
import type { DiagnosticsSetting } from "../application/diagnostics-setting";
import { ViewportBadge } from "./viewport-badge";

const DiagnosticsSettingContext = createContext<DiagnosticsSetting | null>(
  null,
);

const SERVER_SNAPSHOT = false;

// 設定の有効状態を購読し、有効のときだけ全画面にバッジを描く。無効のときは何も追加しない。
// サーバーと初回の描画は無効で、マウント後に保存値が有効ならバッジが出る。
export function ViewportDiagnosticsProvider({
  setting,
  children,
}: {
  setting: DiagnosticsSetting;
  children: ReactNode;
}) {
  const enabled = useSyncExternalStore(
    setting.subscribe,
    setting.read,
    () => SERVER_SNAPSHOT,
  );
  return (
    <DiagnosticsSettingContext.Provider value={setting}>
      {enabled ? <ViewportBadge /> : null}
      {children}
    </DiagnosticsSettingContext.Provider>
  );
}

// 設定の有効状態と、その切り替え。Providerの内側で使う。
export function useDiagnosticsSetting(): {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
} {
  const setting = useContext(DiagnosticsSettingContext);
  if (setting === null) {
    throw new Error(
      "useDiagnosticsSettingはViewportDiagnosticsProviderの内側で使う",
    );
  }
  const enabled = useSyncExternalStore(
    setting.subscribe,
    setting.read,
    () => SERVER_SNAPSHOT,
  );
  const setEnabled = useCallback(
    (next: boolean) => setting.write(next),
    [setting],
  );
  return { enabled, setEnabled };
}
