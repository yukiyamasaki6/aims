import type { Shot } from "./scorecard-types";

// マス。矢の同一性で、エンドの中の何番目の矢か(射順)を兼ねる。矢はマスで指し、矢のIDを持たない。
export type ShotCell = {
  distanceId: string;
  endNumber: number;
  shotNumber: number;
};

type CellShot = Pick<Shot, "distance_id" | "end_number" | "shot_number">;

export function cellOfShot(shot: CellShot): ShotCell {
  return {
    distanceId: shot.distance_id,
    endNumber: shot.end_number,
    shotNumber: shot.shot_number,
  };
}

// マスの鍵。`revision`の表の鍵に使う。
export function shotCellKey(cell: ShotCell): string {
  return `${cell.distanceId}:${cell.endNumber}:${cell.shotNumber}`;
}

export function isSameCell(a: ShotCell, b: ShotCell): boolean {
  return (
    a.distanceId === b.distanceId &&
    a.endNumber === b.endNumber &&
    a.shotNumber === b.shotNumber
  );
}

// マスにある矢。渡す矢が生きている矢だけなら、生きている矢を返す。
export function shotAt<T extends CellShot>(
  shots: readonly T[],
  cell: ShotCell,
): T | undefined {
  return shots.find((s) => isSameCell(cellOfShot(s), cell));
}
