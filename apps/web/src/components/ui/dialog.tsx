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
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-safe">
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className={cn(
            "pointer-events-auto relative max-h-[85%] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-xl border bg-card p-4 text-card-foreground shadow-lg",
            className,
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Popup>
      </div>
    </DialogPrimitive.Portal>
  );
}

export { Dialog, DialogContent, DialogTrigger };
