import { useRef } from "react";
import { useHydrated } from "@/hooks/use-hydrated";
import { useMountedRef } from "@/hooks/use-mounted-ref";
import type { RoundScreen } from "../application/round-window";
import { isRoundInProgress } from "../domain/round-retention";
import type { RoundState } from "../domain/round-tables";
import type { SyncOperation } from "../domain/sync-events";
import { useRoundProcedures } from "./rounds-context";
import { useDistanceEditing } from "./use-distance-editing";
import { useKeypad } from "./use-keypad";
import { useReconciledPointer } from "./use-reconciled-pointer";
import { useReorderAnimation } from "./use-reorder-animation";
import { useScoreHistory } from "./use-score-history";
import { useShotInput } from "./use-shot-input";

// 画面の状態と、操作の追記。状態は窓口が記録(ベースに操作の列を重ねたもの)から導く。
type ScorecardSync = {
  state: RoundState;
  append: (operation: SyncOperation) => RoundState;
};

// 矢の入力に関わる状態(未確定の矢、ポインタ、テンキー、履歴、入力)。
function useScorecardInput(sync: ScorecardSync, inProgress: boolean) {
  const { distances, shots } = sync.state;
  const [pointer, setPointer] = useReconciledPointer(
    inProgress,
    distances,
    shots,
  );
  const keypad = useKeypad({ pointer, distances, setPointer });
  const history = useScoreHistory();
  const input = useShotInput({
    distances,
    shots,
    pointer,
    setPointer: keypad.followPointer,
    append: sync.append,
    history,
  });
  return { pointer, keypad, history, input };
}

type ScorecardOptions = {
  roundId: string;
  screen: RoundScreen;
  append: (operation: SyncOperation) => RoundState;
};

// スコアカード画面の状態と操作。
export function useScorecard(options: ScorecardOptions) {
  const { roundId, screen, append } = options;
  const { leaving } = useRoundProcedures();
  const mountedRef = useMountedRef();
  const sync = { state: screen.state, append };
  const { distances } = sync.state;
  const inProgress = isRoundInProgress(sync.state);
  const scorecardRef = useRef<HTMLDivElement>(null);
  useReorderAnimation(scorecardRef);

  const { pointer, keypad, history, input } = useScorecardInput(
    sync,
    inProgress,
  );
  const editing = useDistanceEditing({
    roundId,
    distances,
    append: sync.append,
    discardHistory: history.discardDistance,
  });

  return {
    roundId,
    targetFaces: screen.targetFaces,
    hydrated: useHydrated(),
    sync,
    initiallyEmpty: screen.initiallyEmpty,
    inProgress,
    scorecardRef,
    pointer,
    keypad,
    history,
    input,
    editing,
    // 完了へ変える操作を積み、保存を待ってから一覧へ移る(待つ間に画面を離れたときは移らない)。移った後も送信は常駐の送信器が続ける。
    onComplete: () => {
      void leaving.completeRound(roundId, () => mountedRef.current);
    },
  };
}

export type ScorecardModel = ReturnType<typeof useScorecard>;
