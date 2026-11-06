import type { IdentityReader } from "@/features/auth";
import type {
  ReferenceKind,
  ReferenceSnapshots,
} from "../application/reference-snapshots";
import {
  ROUND_PRESET_SELECT,
  TARGET_FACE_SELECT,
} from "./reference-query-constants";

// オフラインでも使えるよう、最後にオンラインで得た参照データ（的・プリセット）を
// ユーザーごとに端末へ保存する。サインアウトでは消さず、別のユーザーはキーが違い読めない。
// 取得の失敗・時間切れのときだけ使うスナップショットで、保存の読み書きの失敗は外へ出さない。
// `update`は渡された関数が投げたとき投げる。呼び手は純粋な`withoutPreset`だけで、投げない。
const SHAPES = {
  presets: ROUND_PRESET_SELECT,
  "target-faces": TARGET_FACE_SELECT,
} as const satisfies Record<ReferenceKind, string>;

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
function saveReferenceSnapshot<T>(
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
function loadReferenceSnapshot<T>(
  identityReader: IdentityReader,
  kind: ReferenceKind,
): T | null {
  const userId = identityReader.read();
  if (!userId) return null;
  return read<T>(kind, userId)?.data ?? null;
}

// 保存済みがあるときだけ書き換える。startedAtを現在にし、書き換え前に始まった取得の
// 遅れた結果で、書き換えが戻らないようにする。
function updateReferenceSnapshot<T>(
  identityReader: IdentityReader,
  kind: ReferenceKind,
  update: (data: T) => T,
): void {
  const userId = identityReader.read();
  if (!userId) return;
  const current = read<T>(kind, userId);
  if (!current) return;
  write(kind, userId, update(current.data), Date.now());
}

// 取得の手続きが使う、参照データの保存。読み込みは端末の識別情報の利用者で行う。
export function createReferenceSnapshots(
  identityReader: IdentityReader,
): ReferenceSnapshots {
  return {
    load: <T>(kind: ReferenceKind): T | null =>
      loadReferenceSnapshot<T>(identityReader, kind),
    save: <T>(
      kind: ReferenceKind,
      userId: string,
      data: T,
      startedAt: number,
    ): void => saveReferenceSnapshot(kind, userId, data, startedAt),
    update: <T>(kind: ReferenceKind, update: (data: T) => T): void =>
      updateReferenceSnapshot(identityReader, kind, update),
  };
}
