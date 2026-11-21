import type { Distance, Shot } from "./scorecard-types";
import { isSameCell, type ShotCell, shotAt } from "./shot-cell";

// 指しているマス。何も指していないときはnull。
export type Pointer = ShotCell | null;

export function isSamePointer(a: Pointer, b: Pointer): boolean {
  if (a === null || b === null) return a === b;
  return isSameCell(a, b);
}

// エンドの`fromNumber`以降の、空の最初のマス。
function emptyCellInEnd(
  distance: Distance,
  shots: Shot[],
  endNumber: number,
  fromNumber: number,
): ShotCell | null {
  for (let n = fromNumber; n <= distance.arrows_per_end; n++) {
    const cell = { distanceId: distance.id, endNumber, shotNumber: n };
    if (!shotAt(shots, cell)) return cell;
  }
  return null;
}

// 距離の中で、`fromEnd`のエンド以降の、空の最初のマス(エンドの昇順、マスの番号順)。無ければnull。
function emptyCellFrom(
  distance: Distance,
  shots: Shot[],
  fromEnd: number,
): ShotCell | null {
  for (let end = fromEnd; end <= distance.total_ends; end++) {
    const cell = emptyCellInEnd(distance, shots, end, 1);
    if (cell) return cell;
  }
  return null;
}

// 空の最初のマス(距離の並び順、エンドの昇順、マスの番号順)。全てのマスが埋まっていればnull。
// `distances`は並び順、`shots`は生きている矢とする。
export function firstEmptyCell(distances: Distance[], shots: Shot[]): Pointer {
  for (const distance of distances) {
    const cell = emptyCellFrom(distance, shots, 1);
    if (cell) return cell;
  }
  return null;
}

// 点数を書いた後に指すマス。記録済みのマスを直したときは、そのマスのまま。
// 空のマスへ書いたときは、同じエンドの後ろの最初の空のマス、無ければ同じ距離の後ろのエンドの最初の空のマス、無ければnull(距離をまたがない)。
// 書いたマスより前の空のマスへは戻らない。`shots`は書いた矢を含む。
export function pointerAfterScore(
  distances: Distance[],
  shots: Shot[],
  written: ShotCell,
  wasEmpty: boolean,
): Pointer {
  if (!wasEmpty) return written;
  const distance = distances.find((d) => d.id === written.distanceId);
  if (!distance) return null;
  return (
    emptyCellInEnd(
      distance,
      shots,
      written.endNumber,
      written.shotNumber + 1,
    ) ?? emptyCellFrom(distance, shots, written.endNumber + 1)
  );
}

// 指しているマスを、いまの構成に合わせる。他端末の矢の変化では動かさない。
// 距離が無い、またはマスが距離の範囲(エンド数・射数/エンド)の外になったら何も指さない。
export function reconcilePointer(
  distances: Distance[],
  pointer: Pointer,
): Pointer {
  if (pointer === null) return null;
  const distance = distances.find((d) => d.id === pointer.distanceId);
  if (
    !distance ||
    pointer.endNumber > distance.total_ends ||
    pointer.shotNumber > distance.arrows_per_end
  ) {
    return null;
  }
  return pointer;
}
