"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import * as React from "react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("font-medium text-base", className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  nested = false,
  focusTarget,
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup> & {
  // ネストされたDialog（他のDialog内から開かれるDialog）は、既定では
  // 自身のbackdropを描画しない。すると外側クリックがすべて親側の
  // inert化された要素に吸収され、範囲外タップで閉じられなくなるため、
  // backdropを強制描画してクリックを拾う（重なって少し暗くなるのは、
  // 二重に開いていることが伝わるむしろ望ましい見た目として許容する）。
  nested?: boolean;
  // 開いたとき、ポップアップ自身の代わりにフォーカスを移す要素(例外。app/open-focus)。未指定ならポップアップ自身。
  focusTarget?: React.RefObject<HTMLElement | null>;
}) {
  // 開いたとき入力欄へ自動でフォーカスせず、ポップアップ自身へ移す(app/open-focus)。
  // Base UIの初期フォーカスは開いた直後の非同期で動き、直後の入力を奪うため、マウント時に同期で移す。呼び出し側のinitialFocusとrefは尊重する。
  const ownsInitialFocus = props.initialFocus === undefined;
  const mergedRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      // 子のrefはポップアップより先に付くため、focusTargetは移す時点で参照できる。
      if (node && ownsInitialFocus)
        (focusTarget?.current ?? node).focus({ preventScroll: true });
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref, ownsInitialFocus, focusTarget],
  );
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        forceRender={nested}
        className="fixed inset-0 z-50 bg-black/40"
      />
      <DialogPrimitive.Popup
        ref={mergedRef}
        initialFocus={ownsInitialFocus ? false : undefined}
        className={cn(
          "outline-none fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-4 text-card-foreground shadow-lg",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export { Dialog, DialogContent, DialogTitle, DialogTrigger };
