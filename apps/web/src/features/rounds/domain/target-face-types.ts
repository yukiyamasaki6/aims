export type TargetFaceRing = {
  radius: number;
  color: string;
  line_color: string | null;
  z_index: number;
  score_str: string;
  score_int: number;
};

export type TargetFaceSpotLayout = {
  center_x: number;
  center_y: number;
  target_face_rings: TargetFaceRing[];
};

export type TargetFaceOption = {
  id: string;
  name: string;
  size: number;
  format: string;
  bow_type: string[];
  target_face_spots: TargetFaceSpotLayout[];
};

// 取得した的。個人の的は`ownerId`を持つ。
// DBの行の列名`owner_id`のまま持つ(端末へ保存する値も変えない)。
export type TargetFaceRecord = TargetFaceOption & { owner_id: string | null };

// 個人の的を先に、それぞれ種類(outdoor→indoor→field)→サイズ(大→小)→名前の順に並べる。名前の比較はDBの照合順序でなくJSの比較で、この並びは意図した規則である。
function compareTargetFaces(a: TargetFaceRecord, b: TargetFaceRecord): number {
  const personal = Number(b.owner_id !== null) - Number(a.owner_id !== null);
  if (personal !== 0) return personal;
  if (a.format !== b.format) return a.format < b.format ? 1 : -1;
  if (a.size !== b.size) return b.size - a.size;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export function orderTargetFaces(
  records: readonly TargetFaceRecord[],
): TargetFaceOption[] {
  return [...records].sort(compareTargetFaces);
}
