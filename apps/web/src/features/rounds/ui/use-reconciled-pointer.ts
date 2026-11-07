import { useState } from "react";
import type { Distance, Shot } from "../domain/scorecard-types";
import {
  firstOpenEnd,
  isSamePointer,
  type Pointer,
  reconcilePointer,
} from "../domain/shot-pointer";

// 指している矢。完了のラウンドは、新しい矢を指さない。
// 指している矢が他端末で消えた、エンドが満杯になった、距離が無効になったときは、いまの状態に合わせる。
export function useReconciledPointer(
  inProgress: boolean,
  distances: Distance[],
  shots: Shot[],
) {
  const [storedPointer, setPointer] = useState<Pointer>(() =>
    inProgress ? firstOpenEnd(distances, shots) : null,
  );
  const pointer = reconcilePointer(distances, shots, storedPointer);
  if (!isSamePointer(pointer, storedPointer)) setPointer(pointer);
  return [pointer, setPointer] as const;
}
