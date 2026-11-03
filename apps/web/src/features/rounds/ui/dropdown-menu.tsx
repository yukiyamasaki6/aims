"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type * as React from "react";
import { cn } from "@/lib/utils";

const DropdownMenu = MenuPrimitive.Root;
const DropdownMenuTrigger = MenuPrimitive.Trigger;

function DropdownMenuContent({
  className,
  children,
  align = "end",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Popup> &
  Pick<
    React.ComponentProps<typeof MenuPrimitive.Positioner>,
    "align" | "sideOffset"
  >) {
  return (
    <MenuPrimitive.Portal>
      {/* Portalでbody直下に出るが、Positionerは既定でz-indexを持たない。スクロール中のsticky(z-10〜z-30)の下に隠れないよう、Dialogと同じz-50にする */}
      <MenuPrimitive.Positioner
        align={align}
        sideOffset={sideOffset}
        className="z-50"
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "min-w-32 rounded-lg border bg-card p-1 text-card-foreground shadow-lg outline-none",
            className,
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "cursor-pointer rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
};
