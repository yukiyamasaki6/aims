"use client";

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// レフトパネル（src/components/left-panel-client.tsx）と同じ器（常設パネル
// 化・開閉アニメーション）を左右反転して踏襲した、横向き専用の側パネル。
// 縦向きのボトムシートは呼び出し側（scorecard-client.tsx）が<main>に
// 内蔵する別実装で、この横向き/縦向きの出し分け自体もCSSではなくJSの
// isLandscapeで行っている（このコンポーネントは横向きの時しかマウント
// されない）ため、ここにモバイル向けの分岐は一切持たない。
// レフトパネルとの違いは、閉じた際にレフトパネルのアイコン帯（md:w-14）の
// ような常設の再表示導線を持たず、幅0で完全に見えなくなる点（再表示は
// マス目タップ側の責務）。
export function KeypadPanel({
  mounted,
  visible,
  onNodeChange,
  onClose,
  children,
}: {
  mounted: boolean;
  visible: boolean;
  onNodeChange: (el: HTMLDivElement | null) => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  if (!mounted) return null;

  return (
    <div
      ref={onNodeChange}
      data-testid="keypad-panel"
      aria-hidden={!visible}
      className={cn(
        // スコア領域（flex-1）とのおおよそ3:2の比率になるよう、固定pxでは
        // なく画面幅に対する割合（40%）で幅を決める。<main>が自身の
        // overflow-y-autoで内部スクロールするため、この行自体は画面の
        // 高さを超えて伸びることがなく、この要素は常に画面内に留まる。
        "z-30 h-full shrink-0 overflow-hidden bg-card text-card-foreground transition-[width]",
        visible ? "w-2/5 border-l" : "w-0",
      )}
    >
      <div className="flex h-full flex-col">
        <button
          type="button"
          data-testid="keypad-panel-close"
          onClick={onClose}
          aria-label="テンキーパネルを閉じる"
          className="flex w-full items-center justify-center bg-muted py-1.5 text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="size-5" />
        </button>
        {/* テンキー本体をパネル中央に置く。スマホでは下部固定と体感距離が
            大差なく、PCではマウス操作に指の届きやすさは関係しない上、
            縦長パネルの上半分が常に空白になる下部固定より見た目のバランスが良い。 */}
        <div className="flex flex-1 flex-col justify-center gap-2 overflow-y-auto p-4">
          {children}
        </div>
      </div>
    </div>
  );
}
