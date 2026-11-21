import { useState } from "react";
import type { Distance, Shot } from "../domain/scorecard-types";
import {
  firstEmptyCell,
  isSamePointer,
  type Pointer,
  reconcilePointer,
} from "../domain/shot-pointer";

// 指しているマス。開いたときは、入力中のラウンドなら最初の空のマス、完了のラウンドなら何も指さない。
// 他端末の矢の変化では動かさず、距離が無い、またはマスが距離の範囲の外になったときだけ、何も指さない。
export function useReconciledPointer(
  inProgress: boolean,
  distances: Distance[],
  shots: Shot[],
) {
  const [storedPointer, setPointer] = useState<Pointer>(() =>
    inProgress ? firstEmptyCell(distances, shots) : null,
  );
  const pointer = reconcilePointer(distances, storedPointer);
  if (!isSamePointer(pointer, storedPointer)) setPointer(pointer);
  return [pointer, setPointer] as const;
}
