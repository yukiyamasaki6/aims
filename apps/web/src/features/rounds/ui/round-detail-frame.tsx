import type { ReactNode } from "react";
import { ScreenFrame } from "@/components/screen-frame";
import { BackLink } from "./back-link";
import { useRoundOrigin } from "./use-round-origin";

// 取得中・見つからない・表示中のどれでも同じ枠にし、取得中から表示への遷移でヘッダーを動かさない。
// data-hydratedは付けない。付けると、E2Eのwaitが取得の完了より先に解ける。
export function RoundDetailFrame({
  title,
  actions,
  children,
}: {
  // ラウンド名の部品。取得中・見つからない・オフライン・エラーでは無し。
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const origin = useRoundOrigin();
  return (
    <ScreenFrame
      leading={<BackLink origin={origin} />}
      title={title}
      trailing={actions}
    >
      {children}
    </ScreenFrame>
  );
}
