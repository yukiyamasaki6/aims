import { useTranslations } from "next-intl";
import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { lookupTargetFace, type TargetFaceOption } from "../domain/target-face";
import { FILTER_ALL, filterTargetFaces } from "../domain/target-face-filter";
import { TargetFaceInfo } from "./target-face-info";
import { useOptionLabels } from "./use-option-labels";

// フィルタ（種別・弓種）は絞り込みなし（「指定なし」）も選択肢に含める。ラウンドの種別・弓種を
// 既定にはするが、絞り込みが自由度を奪って目的の的を選べなくなることが
// ないよう、常に全件へ戻れる逃げ道を残す。
function triggerLabel(
  t: ReturnType<typeof useTranslations<"rounds">>,
  selected: TargetFaceOption | "missing",
  locked: boolean | undefined,
): string {
  const name =
    typeof selected === "string" ? t("targetFaceName") : selected.name;
  if (locked) return t("targetFaceTriggerLocked", { name });
  if (selected === "missing") return t("targetFaceTriggerMissing");
  return t("targetFaceTrigger", { name });
}

// 的の選択UI。名称は一切表示せず、実際のリング配色・レイアウト（3つ目の
// トライアングル/バーティカル等）とサイズの数字だけで見分けられるようにする。
// 通常は選択中の1枚だけを的情報（TargetFaceInfo）として表示し、タップすると
// ポップアップで一覧（同じく的情報のリスト）から選び直せる。
export function TargetFacePicker({
  targetFaces,
  selectedId,
  roundFormat,
  roundBowType,
  onSelect,
  locked,
  onLockedPress,
  describedBy,
}: {
  targetFaces: TargetFaceOption[];
  selectedId: string;
  roundFormat: string;
  roundBowType: string;
  onSelect: (id: string) => void;
  locked?: boolean;
  onLockedPress?: () => void;
  describedBy?: string;
}) {
  const t = useTranslations("rounds");
  const [open, setOpen] = useState(false);
  // ラウンドの種別・弓種に対応する選択欄の値を既定にする。選び直した場合はダイアログを
  // 再度開いてもそのまま保持する（開くたびに毎回既定へ戻すと、直前に見ていた
  // 選択を見失ってしまうため）。
  const [selectedFormat, setSelectedFormat] = useState(roundFormat);
  const [selectedBowType, setSelectedBowType] = useState(roundBowType);
  const selected = lookupTargetFace(targetFaces, selectedId);
  const visibleFaces = filterTargetFaces(
    targetFaces,
    selectedFormat,
    selectedBowType,
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (locked ? onLockedPress?.() : setOpen(next))}
    >
      <DialogTrigger
        data-testid="target-face-picker-trigger"
        aria-disabled={locked ? true : undefined}
        aria-describedby={describedBy}
        aria-label={triggerLabel(t, selected, locked)}
        className={cn("w-full", locked && "cursor-not-allowed opacity-50")}
      >
        <TargetFaceInfo face={selected} />
      </DialogTrigger>
      {/* フィルタで絞り込んだ的の件数（3件〜19件）によってポップアップ自体の
          大きさが変わらないよう高さを固定し、フィルタ部分は常に見える位置に
          固定した上で、的の一覧部分だけをスクロールさせる。 */}
      <DialogContent
        nested
        className="flex h-[70vh] flex-col overflow-y-hidden"
      >
        <div className="flex h-full flex-col gap-3">
          <TargetFaceFilters
            format={selectedFormat}
            bowType={selectedBowType}
            onFormatChange={setSelectedFormat}
            onBowTypeChange={setSelectedBowType}
          />
          <TargetFaceList
            faces={visibleFaces}
            selectedId={selectedId}
            onSelect={(id) => {
              onSelect(id);
              setOpen(false);
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// 種別・弓種の絞り込み欄。未選択は「指定なし」で、選択肢の先頭に置く。
export function TargetFaceFilters({
  format,
  bowType,
  onFormatChange,
  onBowTypeChange,
}: {
  format: string;
  bowType: string;
  onFormatChange: (value: string) => void;
  onBowTypeChange: (value: string) => void;
}) {
  const t = useTranslations("rounds");
  const { formatOptions, bowTypeOptions } = useOptionLabels();
  const none = { value: FILTER_ALL, label: t("targetFaceFilterNone") };
  return (
    <div className="grid grid-cols-2 gap-2">
      <Select
        label={t("roundConfigFormat")}
        options={[none, ...formatOptions]}
        value={format}
        onChange={onFormatChange}
        testId="target-face-format-select"
      />
      <Select
        label={t("roundConfigBowType")}
        options={[none, ...bowTypeOptions]}
        value={bowType}
        onChange={onBowTypeChange}
        testId="target-face-bow-type-select"
      />
    </div>
  );
}

export function TargetFaceList({
  faces,
  selectedId,
  onSelect,
}: {
  faces: TargetFaceOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    // 選択中の項目に付くring（box-shadow）がコンテナの縁に接して
    // overflowで見切れないよう、-mx-1で横幅（上の選択欄との揃え）を
    // 保ちつつ、内側に上下左右のpを取ってringの逃げ場を作る。
    // 項目の最小幅から列の数を自動で決める格子にし、幅に余裕があれば複数列、
    // なければ1列にする。各項目の中で的の情報は左右の中央に置く。
    <div className="-mx-1 grid flex-1 grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] content-start gap-2 overflow-y-auto p-1">
      {faces.map((f) => (
        <button
          key={f.id}
          type="button"
          aria-label={f.name}
          aria-pressed={f.id === selectedId}
          data-testid={`target-face-option-${f.id}`}
          onClick={() => onSelect(f.id)}
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md p-2 transition-colors hover:bg-muted",
            f.id === selectedId && "bg-muted ring-1 ring-primary",
          )}
        >
          <TargetFaceInfo face={f} />
        </button>
      ))}
    </div>
  );
}
