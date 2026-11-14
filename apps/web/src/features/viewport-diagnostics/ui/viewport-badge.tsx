"use client";

import { useEffect } from "react";
import { judgeViewport } from "./viewport-judgement";

// 表示領域の測定値を右下に出す診断のバッジ。設定が有効のときだけ描かれ、アンマウントでDOMとリスナーを全て除く。
// 除去は、features/viewport-diagnostics/の削除と、root-client-entry.tsx・settings/page.tsx・i18n/messages.ts・settings-screen.tsx・settings-messages.tsの該当行の削除、docsの該当節の削除。
// 値の識別子(inner、vv、dvh等)は、スクリーンショットで照合するための技術表記で、翻訳しない。

const REDRAW_DELAYS_MS = [500, 2000, 5000];

function unitHeight(css: string): number {
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;left:0;top:0;width:1px;visibility:hidden;height:${css}`;
  document.documentElement.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return Math.round(height);
}

function rangeOf(element: Element | null): string {
  if (!element) return "-";
  const rect = element.getBoundingClientRect();
  return `${Math.round(rect.top)}~${Math.round(rect.bottom)}`;
}

function safeArea(): string {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.documentElement.appendChild(probe);
  const style = getComputedStyle(probe);
  const value = [
    style.paddingTop,
    style.paddingRight,
    style.paddingBottom,
    style.paddingLeft,
  ].join(" ");
  probe.remove();
  return value;
}

type Measurement = {
  inner: number;
  visual: number;
  visualTop: string;
  dvh: number;
  svh: number;
  lvh: number;
  percent: number;
  written: string;
  safeArea: string;
  body: string;
  main: string;
  standalone: boolean;
  status: "ok" | "BAD";
};

// 現在の表示領域の値を取得する。
function measure(): Measurement {
  const visualViewport = window.visualViewport;
  const inner = window.innerHeight;
  const visual = visualViewport
    ? Math.round(visualViewport.height * visualViewport.scale)
    : inner;
  const dvh = unitHeight("100dvh");
  const bodyHeight = Math.round(document.body.getBoundingClientRect().height);
  return {
    inner,
    visual,
    visualTop: visualViewport
      ? String(Math.round(visualViewport.offsetTop))
      : "-",
    dvh,
    svh: unitHeight("100svh"),
    lvh: unitHeight("100lvh"),
    percent: unitHeight("100%"),
    written: getComputedStyle(document.documentElement)
      .getPropertyValue("--app-height")
      .trim(),
    safeArea: safeArea(),
    body: rangeOf(document.body),
    main: rangeOf(document.querySelector("main")),
    standalone: window.matchMedia("(display-mode: standalone)").matches,
    status: judgeViewport({
      visual,
      dvh,
      bodyHeight,
      offsetTop: visualViewport ? visualViewport.offsetTop : null,
    }),
  };
}

function formatMeasurement(m: Measurement, elapsedSeconds: number): string {
  return `${m.status} ${m.standalone ? "SA" : "TAB"} +${elapsedSeconds}s
inner ${m.inner} vv ${m.visual} vvTop ${m.visualTop}
dvh(orig) ${m.dvh} svh ${m.svh} lvh ${m.lvh} pct ${m.percent}
--app-height(written) ${m.written}
safe-area(trbl) ${m.safeArea}
body ${m.body} main ${m.main}`;
}

export function ViewportBadge() {
  useEffect(() => {
    const badge = document.createElement("div");
    badge.style.cssText =
      "position:fixed;right:4px;bottom:4px;z-index:2147483647;font:10px/1.25 monospace;color:#fff;padding:3px 5px;pointer-events:none;opacity:.85;white-space:pre";
    badge.dataset.testid = "viewport-diagnostics-badge";
    const startedAt = Date.now();
    const draw = () => {
      const m = measure();
      badge.style.background = m.status === "BAD" ? "#c00" : "#0a0";
      badge.textContent = formatMeasurement(
        m,
        Math.round((Date.now() - startedAt) / 1000),
      );
    };
    document.body.appendChild(badge);
    draw();
    const timers = REDRAW_DELAYS_MS.map((delay) => setTimeout(draw, delay));
    window.addEventListener("resize", draw);
    window.visualViewport?.addEventListener("resize", draw);
    document.addEventListener("visibilitychange", draw);
    return () => {
      for (const timer of timers) clearTimeout(timer);
      window.removeEventListener("resize", draw);
      window.visualViewport?.removeEventListener("resize", draw);
      document.removeEventListener("visibilitychange", draw);
      badge.remove();
    };
  }, []);
  return null;
}
