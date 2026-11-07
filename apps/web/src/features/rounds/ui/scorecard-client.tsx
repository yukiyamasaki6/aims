"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { LoadedRound } from "../application/round-handle";
import { completionConfirmation } from "../domain/round-progress";
import { summarizeRound } from "../domain/scorecard-scoring";
import type { TargetFaceOption } from "../domain/target-face";
import { BottomFrame } from "./bottom-frame";
import { CompleteRoundBar } from "./complete-round-bar";
import { DistanceSection } from "./distance-section";
import { KeypadButtons } from "./keypad-buttons";
import { KeypadPanel } from "./keypad-panel";
import { RoundConfigPanel } from "./round-config-panel";
import { RoundSummaryBar } from "./round-summary-bar";
import { ScorecardHeaderBar } from "./scorecard-header-bar";
import { type ScorecardModel, useScorecard } from "./use-scorecard";

export function ScorecardClient({
  roundId,
  loaded,
  targetFaces,
  onGone,
}: {
  roundId: string;
  loaded: LoadedRound;
  targetFaces: TargetFaceOption[];
  // 端末のベースで開いたラウンドが、取り直したサーバーに無いとき(削除済みなど)に呼ぶ。
  onGone: () => void;
}) {
  const model = useScorecard({
    roundId,
    loaded,
    targetFaces,
    onGone,
  });
  const { sync, keypad } = model;
  const { roundConfig, distances, shots, status } = sync.state;
  // テンキーは指す矢があるか、格納の待ち(直近の距離を保持)のときだけ付く。一度も指していないときは距離が無く、付かない。
  const keypadButtons = keypad.keypadDistance && (
    <KeypadButtons
      keypadDistance={keypad.keypadDistance}
      targetFaces={targetFaces}
      pointer={model.pointer}
      history={model.history}
      input={model.input}
    />
  );

  return (
    // h-fullにすることで、この行の高さが常に実際の可視領域（レフトパネルの
    // モバイルヘッダー分を除いた高さ）に一致する。KeypadPanelはこの行の
    // flexアイテムとしてデフォルトのstretchで高さを得ており、この値が
    // 正しくないと横向き時にパネル下端が画面外へはみ出す（h-screen固定に
    // していた際の不具合）。縦の列の中で、ヘッダーと完了の帯・テンキーは
    // スクロール領域（<main>）の外に置き、<main>がその間の高さで内部スクロール
    // する。<main>の矩形が、行が見える範囲そのものになる。
    <div data-hydrated={model.hydrated} className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-xl shrink-0">
          <ScorecardHeaderBar
            roundId={roundId}
            roundConfig={roundConfig}
            distances={distances}
            targetFaces={targetFaces}
          />
        </div>
        <main
          ref={keypad.observeContainer}
          data-follow-container
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        >
          <div className="mx-auto flex w-full max-w-xl flex-1 flex-col">
            <ScorecardBody model={model} />
          </div>
        </main>

        <BottomFrame
          keypad={keypad}
          completeBar={
            <CompleteRoundBar
              status={status}
              confirmation={completionConfirmation(distances, shots)}
              onComplete={model.onComplete}
            />
          }
        >
          {keypadButtons}
        </BottomFrame>
      </div>
      {keypad.isLandscape && (
        <KeypadPanel
          mounted={keypad.keypadMounted}
          visible={keypad.keypadVisible}
          onNodeChange={keypad.setKeypadNode}
          onClose={keypad.closeKeypad}
        >
          {keypadButtons}
        </KeypadPanel>
      )}
    </div>
  );
}

// ラウンドの設定、合計、距離ごとのカード。
function ScorecardBody({ model }: { model: ScorecardModel }) {
  const t = useTranslations("rounds");
  const { sync, editing, input, targetFaces } = model;
  const { roundConfig, distances, shots } = sync.state;
  const distanceIdsWithShots = new Set(shots.map((s) => s.distance_id));

  return (
    <div className="flex flex-1 flex-col gap-6 px-8 pb-8">
      <RoundConfigPanel
        roundId={model.roundId}
        initial={roundConfig}
        defaultExpanded={model.initiallyEmpty && model.inProgress}
        hasUnmarkedDistances={distances.some((d) => !d.is_marked)}
        enqueue={sync.append}
      />
      <RoundSummaryBar
        roundSummary={summarizeRound(distances, targetFaces, shots)}
      />

      <div ref={model.scorecardRef} className="flex flex-col gap-4">
        {distances.map((d) => (
          <DistanceSection
            key={d.id}
            distance={d}
            distances={distances}
            shots={shots}
            targetFaces={targetFaces}
            roundFormat={roundConfig.format}
            roundBowType={roundConfig.bowType}
            editing={editing.editingDistanceId === d.id}
            hasShots={distanceIdsWithShots.has(d.id)}
            pointer={model.pointer}
            onToggleEditing={() => editing.toggleDistanceEditing(d.id)}
            onSaved={editing.handleDistanceSaved}
            onDeleted={() => editing.handleDistanceDeleted(d.id)}
            enqueue={sync.append}
            onSelectShot={input.selectShot}
            onSelectEnd={input.selectEnd}
            onLinesChange={model.keypad.follow}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          size="lg"
          data-testid="add-distance-button"
          onClick={editing.handleAddDistance}
          className="h-12 border-dashed"
        >
          <Plus />
          {t("addDistance")}
        </Button>
      </div>
    </div>
  );
}
