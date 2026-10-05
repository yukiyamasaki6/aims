import { getLocalIdentity } from "@/features/auth/local-identity";
import {
  ROUND_PRESET_SELECT,
  TARGET_FACE_SELECT,
} from "./reference-query-constants";

// オフラインでも使えるよう、最後にオンラインで得た参照データ（的・プリセット）を
// ユーザーごとに端末へ保存する。サインアウトでは消さず、別のユーザーはキーが違い読めない。
// 取得の失敗・時間切れのときだけ使うスナップショットで、すべての関数は例外を外へ出さない。
const SHAPES = {
  presets: ROUND_PRESET_SELECT,
  "target-faces": TARGET_FACE_SELECT,
} as const;

export type ReferenceKind = keyof typeof SHAPES;

// shape: 取得のselect文字列。取得する列を変えたビルドで古い形を読まないために持つ。
// startedAt: その内容を得た取得の開始時刻。古い取得の結果で新しい保存済みを戻さないために使う。
type Stored<T> = { shape: string; startedAt: number; data: T };

function keyOf(kind: ReferenceKind, userId: string): string {
  return `aims:reference:${kind}:${userId}`;
}

function read<T>(kind: ReferenceKind, userId: string): Stored<T> | null {
  try {
    const raw = window.localStorage.getItem(keyOf(kind, userId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as Stored<T>).shape !== SHAPES[kind] ||
      typeof (parsed as Stored<T>).startedAt !== "number" ||
      !("data" in parsed)
    ) {
      return null;
    }
    return parsed as Stored<T>;
  } catch {
    return null;
  }
}

function write<T>(
  kind: ReferenceKind,
  userId: string,
  data: T,
  startedAt: number,
): void {
  try {
    const stored: Stored<T> = { shape: SHAPES[kind], startedAt, data };
    window.localStorage.setItem(keyOf(kind, userId), JSON.stringify(stored));
  } catch {
    // 使えない・容量超過のときは保存しない。
  }
}

// userIdは、取得の開始時にクエリに使ったセッションのユーザー。
// 遅れて届いた結果が、別のユーザーのキーへ書かれないようにする。
export function saveReferenceSnapshot<T>(
  kind: ReferenceKind,
  userId: string,
  data: T,
  startedAt: number,
): void {
  const current = read<T>(kind, userId);
  if (current && current.startedAt > startedAt) return;
  write(kind, userId, data, startedAt);
}

// オフラインではセッションを検証できないため、操作の列と同じ基準（端末の識別）で読む。
export function loadReferenceSnapshot<T>(kind: ReferenceKind): T | null {
  const userId = getLocalIdentity();
  if (!userId) return null;
  return read<T>(kind, userId)?.data ?? null;
}

// 保存済みがあるときだけ書き換える。startedAtを現在にし、書き換え前に始まった取得の
// 遅れた結果で、書き換えが戻らないようにする。
export function updateReferenceSnapshot<T>(
  kind: ReferenceKind,
  update: (data: T) => T,
): void {
  const userId = getLocalIdentity();
  if (!userId) return;
  const current = read<T>(kind, userId);
  if (!current) return;
  try {
    write(kind, userId, update(current.data), Date.now());
  } catch {
    // 書き換えに失敗したときは保存済みを変えない。
  }
}
