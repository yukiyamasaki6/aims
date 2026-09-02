"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type * as React from "react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;

function DialogContent({
  className,
  children,
  nested = false,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup> & {
  // ネストされたDialog（他のDialog内から開かれるDialog）は、既定では
  // 自身のbackdropを描画しない。すると外側クリックがすべて親側の
  // inert化された要素に吸収され、範囲外タップで閉じられなくなるため、
  // backdropを強制描画してクリックを拾う（重なって少し暗くなるのは、
  // 二重に開いていることが伝わるむしろ望ましい見た目として許容する）。
  nested?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        forceRender={nested}
        className="fixed inset-0 z-50 bg-black/40"
      />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-4 text-card-foreground shadow-lg",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export { Dialog, DialogContent, DialogTrigger };
