import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { useKeypad } from "./use-keypad";

type KeypadState = ReturnType<typeof useKeypad>;

// 完了の帯とテンキーを、<main>の外の下端に置く1つの枠に入れる。
// 帯は枠の下端に置き、テンキーは同じ枠の中で帯の上に重ねる。
// 枠が<main>の外にあるため、<main>の高さが枠に追従して縮む/伸びる。
// 枠の高さだけがテンキーの表示で変わるため、帯の位置と見た目は
// テンキーの表示前後で変わらず、テンキーが帯を覆う。
// 縦向きのテンキーを開く間は、枠の高さをテンキーの高さにする。
// 開くときは即座に確保し、格納するときはテンキーのスライドと同じ200msで
// 高さを戻す。アンマウント時に一度に戻すと、<main>の高さが急に変わる。
// 格納ボタン（テンキーの上に3rem出ている）は、枠の上へはみ出して<main>の下端に重なる。
// テンキーは枠の上3remから下端までのクリップ枠に入れ、格納中にスライドで
// 枠の下へ出た分が画面を広げないようにしつつ、ボタンは切らない。
// 枠の高さにはボタンを含めないため、枠の高さは帯の高さへ単調に戻り、
// <main>の高さが後から急に変わらない。
// shrink-0は必須: 縦の列のflexアイテムとして、枠がデフォルトのshrinkで潰されないようにする。
export function BottomFrame({
  keypad,
  completeBar,
  children,
}: {
  keypad: KeypadState;
  completeBar: ReactNode;
  // テンキーの中身。
  children: ReactNode;
}) {
  const { isLandscape, keypadMounted, keypadShouldBeOpen, keypadHeight } =
    keypad;
  const reserved = !isLandscape && keypadMounted && keypadShouldBeOpen;
  return (
    <div
      data-testid="bottom-frame"
      className={cn(
        "pointer-events-none relative z-30 flex shrink-0 flex-col justify-end",
        !keypadShouldBeOpen && "transition-[min-height] duration-200",
      )}
      style={{
        minHeight: reserved ? keypadHeight : 0,
      }}
    >
      <div className="pointer-events-auto">{completeBar}</div>

      {!isLandscape && keypadMounted && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 -top-12 overflow-clip">
          <KeypadSheet keypad={keypad}>{children}</KeypadSheet>
        </div>
      )}
    </div>
  );
}

// 縦向きのボトムシート。
function KeypadSheet({
  keypad,
  children,
}: {
  keypad: KeypadState;
  children: ReactNode;
}) {
  return (
    <div
      ref={keypad.setKeypadNode}
      className={cn(
        "pointer-events-auto absolute inset-x-0 bottom-0 z-30 border-t-2 border-foreground/20 bg-card shadow-[0_-4px_6px_-1px_rgb(0_0_0/0.1),0_-2px_4px_-2px_rgb(0_0_0/0.1)] transition-transform duration-200",
        // 格納ボタンが本体の上に3rem（-top-12）はみ出しているため、
        // 100%移動だけではそのはみ出し分が画面下端に残って見えて
        // しまう。はみ出し分を上乗せして完全に隠す。
        keypad.keypadVisible
          ? "translate-y-0"
          : "translate-y-[calc(100%+3rem)]",
      )}
    >
      <div className="relative mx-auto max-w-xl">
        <button
          type="button"
          data-testid="keypad-toggle"
          onClick={keypad.closeKeypad}
          aria-label="テンキーを閉じる"
          className="-top-12 absolute right-4 flex h-12 w-[calc((100%-3.5rem)/4)] items-center justify-center rounded-t-lg border-2 border-b-0 border-foreground/20 bg-card text-muted-foreground shadow-[0_-4px_6px_-1px_rgb(0_0_0/0.1),0_-2px_4px_-2px_rgb(0_0_0/0.1)] hover:text-foreground active:bg-muted"
        >
          <ChevronDown className="size-6" />
        </button>
        <div className="flex flex-col gap-2 p-4 pt-4">{children}</div>
      </div>
    </div>
  );
}
