// 的の絞り込みで、種別・弓種を限定しないことを表す値。
export const FILTER_ALL = "all";

// 種別・弓種のそれぞれについて、FILTER_ALLなら絞り込まない。
export function filterTargetFaces<
  T extends { format: string; bow_type: string[] },
>(targetFaces: T[], format: string, bowType: string): T[] {
  return targetFaces.filter(
    (f) =>
      (format === FILTER_ALL || f.format === format) &&
      (bowType === FILTER_ALL || f.bow_type.includes(bowType)),
  );
}
