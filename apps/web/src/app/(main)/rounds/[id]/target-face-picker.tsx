import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import {
  BOW_TYPE_OPTIONS,
  FORMAT_OPTIONS,
} from "@/features/rounds/round-constants";
import type { TargetFaceOption } from "@/features/rounds/target-face-types";
import { cn } from "@/lib/utils";
import { lookupTargetFace, TargetFaceInfo } from "../_shared/target-face-icon";
import { filterTargetFaces } from "./distance-config";
import { FILTER_ALL } from "./distance-config-constants";

// フィルタ（種別・弓種）は「すべて」も選択肢に含める。ラウンドの種別・弓種を
// 既定にはするが、絞り込みが自由度を奪って目的の的を選べなくなることが
// ないよう、常に全件へ戻れる逃げ道を残す。
const FORMAT_FILTER_OPTIONS = [
  { value: FILTER_ALL, label: "すべて" },
  ...FORMAT_OPTIONS,
];
const BOW_TYPE_FILTER_OPTIONS = [
  { value: FILTER_ALL, label: "すべて" },
  ...BOW_TYPE_OPTIONS,
];

function triggerLabel(
  selected: TargetFaceOption | "missing",
  locked: boolean | undefined,
): string {
  const name = typeof selected === "string" ? "的" : selected.name;
  if (locked) return `${name}（スコア記録済みのため変更不可）`;
  if (selected === "missing") return "的データを取得できません（タップで変更）";
  return `${name}（タップで変更）`;
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
  const [open, setOpen] = useState(false);
  // ラウンドの種別・弓種に対応するタブを既定にする。選び直した場合はダイアログを
  // 再度開いてもそのまま保持する（開くたびに毎回既定へ戻すと、直前に見ていた
  // タブを見失ってしまうため）。
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
        aria-label={triggerLabel(selected, locked)}
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
          <FilterTabs
            options={FORMAT_FILTER_OPTIONS}
            current={selectedFormat}
            testIdPrefix="target-face-format-tab"
            onChange={setSelectedFormat}
          />
          <FilterTabs
            options={BOW_TYPE_FILTER_OPTIONS}
            current={selectedBowType}
            testIdPrefix="target-face-bow-type-tab"
            onChange={setSelectedBowType}
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

function FilterTabs({
  options,
  current,
  testIdPrefix,
  onChange,
}: {
  options: { value: string; label: string }[];
  current: string;
  testIdPrefix: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {options.map((o) => (
        <Button
          key={o.value}
          type="button"
          variant={current === o.value ? "default" : "outline"}
          size="sm"
          data-testid={`${testIdPrefix}-${o.value}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

function TargetFaceList({
  faces,
  selectedId,
  onSelect,
}: {
  faces: TargetFaceOption[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    // 選択中の項目に付くring（box-shadow）がコンテナの縁に接して
    // overflowで見切れないよう、-mx-1で横幅（上のタブ行との揃え）を
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
