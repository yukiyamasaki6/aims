import { useRef } from "react";
import { useHydrated } from "@/hooks/use-hydrated";
import { useMountedRef } from "@/hooks/use-mounted-ref";
import type { LoadedRound } from "../application/round-handle";
import { isRoundInProgress } from "../domain/round-retention";
import { useRoundProcedures } from "./rounds-context";
import { useDistanceEditing } from "./use-distance-editing";
import { useKeypad } from "./use-keypad";
import { useReconciledPointer } from "./use-reconciled-pointer";
import { useReorderAnimation } from "./use-reorder-animation";
import { useRoundOpStack } from "./use-round-op-stack";
import { useScoreHistory } from "./use-score-history";
import { useShotInput } from "./use-shot-input";

// 矢の入力に関わる状態(未確定の矢、ポインタ、テンキー、履歴、入力)。
function useScorecardInput(
  sync: ReturnType<typeof useRoundOpStack>,
  inProgress: boolean,
) {
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
  loaded: LoadedRound;
  onGone: () => void;
};

// スコアカード画面の状態と操作。
export function useScorecard(options: ScorecardOptions) {
  const { roundId, loaded } = options;
  const { leaving } = useRoundProcedures();
  const mountedRef = useMountedRef();
  // 画面の状態は、ベースへ操作の列を重ねた導出だけから得る。
  const sync = useRoundOpStack(roundId, loaded, options.onGone);
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
    targetFaces: sync.targetFaces,
    hydrated: useHydrated(),
    sync,
    initiallyEmpty: loaded.base.distances.length === 0,
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
