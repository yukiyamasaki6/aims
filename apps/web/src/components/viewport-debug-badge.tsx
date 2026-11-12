"use client";

import { useEffect } from "react";

// 一時の確認用(マージしない)。右下に表示領域の現在値を出す。
// 除去は、このファイルの削除と、app/layout.tsxのimportと<ViewportDebugBadge />の削除だけ。

function unitHeight(css: string): number {
  const e = document.createElement("div");
  e.style.cssText = `position:fixed;left:0;top:0;width:1px;visibility:hidden;height:${css}`;
  document.documentElement.appendChild(e);
  const v = e.getBoundingClientRect().height;
  e.remove();
  return Math.round(v);
}

function rangeOf(el: Element | null): string {
  if (!el) return "-";
  const x = el.getBoundingClientRect();
  return `${Math.round(x.top)}~${Math.round(x.bottom)}`;
}

function safeArea(): string {
  const e = document.createElement("div");
  e.style.cssText =
    "position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.documentElement.appendChild(e);
  const c = getComputedStyle(e);
  const v = [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft].join(
    " ",
  );
  e.remove();
  return v;
}

export function ViewportDebugBadge() {
  useEffect(() => {
    const b = document.createElement("div");
    b.style.cssText =
      "position:fixed;right:4px;bottom:4px;z-index:2147483647;font:10px/1.25 monospace;color:#fff;padding:3px 5px;pointer-events:none;opacity:.85;white-space:pre";
    const t0 = Date.now();
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 一時の確認用で、マージしない
    const draw = () => {
      const vv = window.visualViewport;
      const inner = window.innerHeight;
      const vvH = vv ? Math.round(vv.height * vv.scale) : inner;
      const dvh = unitHeight("100dvh");
      const written = getComputedStyle(document.documentElement)
        .getPropertyValue("--app-height")
        .trim();
      const bodyH = Math.round(document.body.getBoundingClientRect().height);
      const bad = Math.abs(dvh - vvH) > 2 || Math.abs(bodyH - vvH) > 2;
      const shifted = vv && Math.abs(vv.offsetTop) > 1;
      b.style.background = bad || shifted ? "#c00" : "#0a0";
      b.textContent = `${bad || shifted ? "BAD " : "ok "}${
        matchMedia("(display-mode: standalone)").matches ? "SA" : "TAB"
      } +${Math.round((Date.now() - t0) / 1000)}s
inner ${inner} vv ${vvH} vvTop ${vv ? Math.round(vv.offsetTop) : "-"}
dvh(orig) ${dvh} svh ${unitHeight("100svh")} lvh ${unitHeight("100lvh")} pct ${unitHeight("100%")}
--app-height(written) ${written}
safe-area(trbl) ${safeArea()}
body ${rangeOf(document.body)} main ${rangeOf(document.querySelector("main"))}`;
    };
    document.body.appendChild(b);
    draw();
    const timers = [500, 2000, 5000].map((d) => setTimeout(draw, d));
    addEventListener("resize", draw);
    window.visualViewport?.addEventListener("resize", draw);
    document.addEventListener("visibilitychange", draw);
    return () => {
      for (const t of timers) clearTimeout(t);
      removeEventListener("resize", draw);
      window.visualViewport?.removeEventListener("resize", draw);
      document.removeEventListener("visibilitychange", draw);
      b.remove();
    };
  }, []);
  return null;
}
