import { useRouter } from "next/navigation";
import { useRef } from "react";
import type { IdentityReader, SessionReader } from "@/features/auth";
import { isRoundInProgress } from "@/features/rounds/round-base";
import type { SyncOperation } from "@/features/rounds/sync-events";
import type { TargetFaceOption } from "@/features/rounds/target-face-types";
import { useHydrated } from "@/hooks/use-hydrated";
import type { LoadedRound } from "./load-round-detail";
import { statusOperation } from "./round-progress";
import { useDistanceEditing } from "./use-distance-editing";
import { useKeypad } from "./use-keypad";
import { useReorderAnimation } from "./use-reorder-animation";
import { useRoundOpStack } from "./use-round-op-stack";
import { useScoreHistory } from "./use-score-history";
import {
  usePendingShots,
  useReconciledPointer,
  useShotInput,
} from "./use-shot-input";

// 完了へ変える操作を積み、保存を待ってから一覧へ移る。移った後も送信は常駐の送信器が続ける。
function useCompleteRound(
  roundId: string,
  append: (operation: SyncOperation) => Promise<void>,
) {
  const router = useRouter();
  return () => {
    void append(
      statusOperation(roundId, "completed", crypto.randomUUID()),
    ).then(() => router.push("/rounds"));
  };
}

// 矢の入力に関わる状態(未確定の矢、ポインタ、テンキー、履歴、入力)。
function useScorecardInput(
  sync: ReturnType<typeof useRoundOpStack>,
  inProgress: boolean,
) {
  const { distances, shots } = sync.state;
  const pending = usePendingShots(sync.append, shots);
  const [pointer, setPointer] = useReconciledPointer(
    inProgress,
    distances,
    shots,
    pending.liveShots,
  );
  const keypad = useKeypad({ pointer, distances, setPointer });
  const history = useScoreHistory();
  const input = useShotInput({
    distances,
    liveShots: pending.liveShots,
    pointer,
    setPointer: keypad.followPointer,
    setKeypadMounted: keypad.setKeypadMounted,
    appendShot: pending.appendShot,
    history,
  });
  return { pending, pointer, setPointer, keypad, history, input };
}

type ScorecardOptions = {
  sessionReader: SessionReader;
  identityReader: IdentityReader;
  roundId: string;
  loaded: Pick<LoadedRound, "base" | "group" | "source" | "pendingServer">;
  targetFaces: TargetFaceOption[];
  onGone?: () => void;
};

// スコアカード画面の状態と操作。
export function useScorecard(options: ScorecardOptions) {
  const { roundId, loaded, targetFaces } = options;
  // 画面の状態は、ベースへ操作の列を重ねた導出だけから得る。
  const sync = useRoundOpStack(
    options.sessionReader,
    options.identityReader,
    roundId,
    loaded,
    targetFaces,
    options.onGone,
  );
  const { distances } = sync.state;
  const inProgress = isRoundInProgress(sync.state);
  const scorecardRef = useRef<HTMLDivElement>(null);
  useReorderAnimation(scorecardRef);

  const { pending, pointer, setPointer, keypad, history, input } =
    useScorecardInput(sync, inProgress);
  const editing = useDistanceEditing({
    roundId,
    distances,
    pointer,
    setPointer,
    append: sync.append,
    discardHistory: history.discardDistance,
  });

  return {
    roundId,
    targetFaces,
    hydrated: useHydrated(),
    sync,
    initiallyEmpty: loaded.base.distances.length === 0,
    inProgress,
    scorecardRef,
    pointer,
    leavingShotId: pending.leavingShotId,
    keypad,
    history,
    input,
    editing,
    onComplete: useCompleteRound(roundId, sync.append),
  };
}

export type ScorecardModel = ReturnType<typeof useScorecard>;
