import type { Tables } from "@/types/supabase";

export type TargetFaceRing = Pick<
  Tables<"target_face_rings">,
  "radius" | "color" | "line_color" | "z_index" | "score_str" | "score_int"
>;

export type TargetFaceSpotLayout = Pick<
  Tables<"target_face_spots">,
  "center_x" | "center_y"
> & {
  target_face_rings: TargetFaceRing[];
};

export type TargetFaceLayout = {
  size: number;
  target_face_spots: TargetFaceSpotLayout[];
};

// 的の一覧に見つからなければ"missing"。
export type TargetFaceView = TargetFaceLayout | "missing";

export function lookupTargetFace<T extends { id: string }>(
  faces: T[],
  id: string,
): T | "missing" {
  return faces.find((f) => f.id === id) ?? "missing";
}

export type TargetFaceOption = Pick<
  Tables<"target_faces">,
  "id" | "name" | "size" | "format" | "bow_type"
> & {
  target_face_spots: TargetFaceSpotLayout[];
};

// 取得した的。個人の的は`ownerId`を持つ。
// 列は生成型から導き、端末へ保存する値の形は変えない。
export type TargetFaceRecord = TargetFaceOption &
  Pick<Tables<"target_faces">, "owner_id">;

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
