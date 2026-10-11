import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { KEYPAD_TOGGLE_OVERHANG, type useKeypad } from "./use-keypad";

type KeypadState = ReturnType<typeof useKeypad>;

// 完了の帯とテンキーを、<main>の最下部に張り付く1つの枠に入れる。
// 帯は枠の下端に置き、テンキーは同じ枠の中で帯の上に重ねる。
// 枠の高さだけがテンキーの表示で変わるため、帯の位置と見た目は
// テンキーの表示前後で変わらず、テンキーが帯を覆う。
// 縦向きのテンキーを開く間は、枠の高さをテンキーの高さ以上にして
// 内容が隠れないようにする。開くときは即座に確保し、格納するときは
// テンキーのスライドと同じ200msで高さを戻す。アンマウント時に一度に
// 戻すと、スクロール領域の下側がテンキーが閉じた後に急に変わる。
// 枠はoverflow-y-clipにする。格納中にスライドで下へ出たテンキーが
// <main>のスクロール領域を一時的に広げ、アンマウント時に一度に
// 縮めて、スクロール領域の下側を急に変えるため。クリップで格納ボタン
// （テンキーの上に3rem出ている）が切れないよう、枠の高さに含める。
// shrink-0は必須: <main>が横向き側パネルとの高さ調整のためflexアイテム
// （高さが固定）になったことで、枠がflexのデフォルトshrinkで潰される。
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
  return (
    <div
      data-testid="bottom-frame"
      className={cn(
        "pointer-events-none sticky bottom-0 z-30 flex shrink-0 flex-col justify-end overflow-y-clip",
        !keypadShouldBeOpen && "transition-[min-height] duration-200",
      )}
      style={{
        minHeight:
          !isLandscape && keypadMounted && keypadShouldBeOpen
            ? keypadHeight + KEYPAD_TOGGLE_OVERHANG
            : 0,
      }}
    >
      <div className="pointer-events-auto">{completeBar}</div>

      {!isLandscape && keypadMounted && (
        <KeypadSheet keypad={keypad}>{children}</KeypadSheet>
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
