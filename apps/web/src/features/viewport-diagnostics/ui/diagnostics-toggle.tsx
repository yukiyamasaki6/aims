"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { useDiagnosticsSetting } from "./viewport-diagnostics-provider";

// 表示領域の診断の切り替え。ラベルと説明を持つスイッチで、キーボードで操作できる。
export function DiagnosticsToggle() {
  const t = useTranslations("viewportDiagnostics");
  const { enabled, setEnabled } = useDiagnosticsSetting();
  const descriptionId = useId();
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 font-medium">
        <input
          type="checkbox"
          role="switch"
          className="size-4"
          checked={enabled}
          aria-checked={enabled}
          aria-describedby={descriptionId}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        {t("toggleLabel")}
      </label>
      <p id={descriptionId} className="text-sm text-muted-foreground">
        {t("toggleDescription")}
      </p>
    </div>
  );
}
