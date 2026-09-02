"use client";

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Redo,
  Undo,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { TargetFaceIcon, TargetFaceTile } from "@/components/target-face-icon";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  addDistance,
  clearShot,
  recordShot,
  saveRoundAsPreset,
} from "./actions";
import {
  type DistanceConfig,
  DistanceEditFields,
  type TargetFaceOption,
} from "./distance-config-row";
import {
  BOW_TYPE_OPTIONS,
  FORMAT_OPTIONS,
  labelOf,
  type RoundConfig,
  RoundConfigPanel,
} from "./round-config-panel";

type Distance = {
  id: string;
  distance_number: number;
  distance: number | null;
  total_ends: number;
  arrows_per_end: number;
  target_face_id: string;
  is_marked: boolean;
};

type Shot = {
  distance_id: string;
  end_number: number;
  arrow_number: number;
  score_str: string;
  score_int: number;
};

// 1回の入力操作（記録・上書き・クリア）による、あるマスの状態遷移。
// undo時はprevShotへ、redo時はnextShotへそのマスを戻す。
type HistoryEntry = {
  distanceId: string;
  endNumber: number;
  arrowNumber: number;
  prevShot: Shot | null;
  nextShot: Shot | null;
};

// テンキーは中身のキー数が距離の的ごとに変わるため実測高さを使う。この値は
// ResizeObserverが初回計測を終えるまでの暫定値。
const KEYPAD_HEIGHT_FALLBACK = 220;

// Mは的のリングではなく「的の外」を表す固定キーのため、常に末尾に追加する。
const MISS_KEY = {
  label: "M",
  scoreStr: "M",
  scoreInt: 0,
  bg: "#4CD964",
  fg: "#231F20",
};

function contrastText(hex: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#231F20" : "#FFFFFF";
}

// 距離の的（target_face_rings）に実在する点数のリングだけを、点数ごとに1つに
// 重複排除して返す。3つ目の的（トライアングル/バーティカル）は通常スポットごとに
// 同一の点数構成だが、異なる可能性も考慮して全スポットのリングを対象にする。
function uniqueRingsFor(targetFace: TargetFaceOption | undefined) {
  const allRings = (targetFace?.target_face_spots ?? []).flatMap(
    (spot) => spot.target_face_rings,
  );
  return Array.from(new Map(allRings.map((r) => [r.score_str, r])).values());
}

// 距離の的に実在する点数・配色だけをテンキーのキーとして構成する。的によって
// リング数が異なる（例: 6点的は1〜4が無い）ため、固定のキー一覧は持たない。
function keypadKeysFor(targetFace: TargetFaceOption | undefined) {
  const scoreKeys = uniqueRingsFor(targetFace)
    .sort((a, b) => b.z_index - a.z_index)
    .map((r) => ({
      label: r.score_str,
      scoreStr: r.score_str,
      scoreInt: r.score_int,
      bg: r.color,
      fg: contrastText(r.color),
    }));
  return [...scoreKeys, MISS_KEY];
}

// マス目に記録済みの点数の実際のリング色を引く。Mは的のリングではなく
// 「的の外」を表す固定色のため、MISS_KEYの色をそのまま使う。
function ringColorFor(
  targetFace: TargetFaceOption | undefined,
  scoreStr: string,
): string {
  if (scoreStr === "M") return MISS_KEY.bg;
  return (
    uniqueRingsFor(targetFace).find((r) => r.score_str === scoreStr)?.color ??
    MISS_KEY.bg
  );
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const diff = max - min;
  if (diff === 0) return [0, 0, l];

  const s = l > 0.5 ? diff / (2 - max - min) : diff / (max + min);
  let h: number;
  if (max === rn) {
    h = ((gn - bn) / diff) % 6;
  } else if (max === gn) {
    h = (bn - rn) / diff + 2;
  } else {
    h = (rn - gn) / diff + 4;
  }
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

// 的の実際のリング色から、同じ色相・彩度のまま明度だけを上げた薄いトーンを
// 生成する。固定の配色テーブルを持たないことで、任意の的の配色（フィールド的
// 等、標準のWAしきい値と対応しない配色を含む）にそのまま追従できる。
// 背景は常に薄い色になるため、文字色は輝度判定不要で固定の黒でよい。
function paleTone(hex: string): { bg: string; fg: string } {
  const [h, s] = rgbToHsl(...hexToRgb(hex));
  return {
    bg: hslToHex(h, s, 0.9),
    fg: "#231F20",
  };
}

type Position = { distance: Distance; end: number; arrow: number };

function findCurrentPosition(
  distances: Distance[],
  shots: Shot[],
): Position | null {
  for (const d of distances) {
    for (let end = 1; end <= d.total_ends; end++) {
      for (let arrow = 1; arrow <= d.arrows_per_end; arrow++) {
        const recorded = shots.some(
          (s) =>
            s.distance_id === d.id &&
            s.end_number === end &&
            s.arrow_number === arrow,
        );
        if (!recorded) {
          return { distance: d, end, arrow };
        }
      }
    }
  }
  return null;
}

function flattenCells(distances: Distance[]): Position[] {
  const cells: Position[] = [];
  for (const d of distances) {
    for (let end = 1; end <= d.total_ends; end++) {
      for (let arrow = 1; arrow <= d.arrows_per_end; arrow++) {
        cells.push({ distance: d, end, arrow });
      }
    }
  }
  return cells;
}

function stepPosition(
  distances: Distance[],
  current: Position,
  offset: 1 | -1,
): Position | null {
  const cells = flattenCells(distances);
  const index = cells.findIndex(
    (c) =>
      c.distance.id === current.distance.id &&
      c.end === current.end &&
      c.arrow === current.arrow,
  );
  if (index === -1) return null;
  return cells[index + offset] ?? null;
}

// プリセット保存ダイアログの名前欄プレースホルダーに使う、種別・弓種・距離構成
// から機械的に組み立てたデフォルト名。ラウンド名が設定されている場合はそちらを
// 優先する（generatePresetNameはラウンド名が空のときのフォールバックとして使う）。
// ユーザーが何も入力せず保存した場合は、このプレースホルダーがそのまま採用される。
function generatePresetName(
  format: string,
  bowType: string,
  distances: Distance[],
): string {
  const distancePart = [...distances]
    .sort((a, b) => a.distance_number - b.distance_number)
    .map((d) => (d.distance !== null ? `${d.distance}` : "??"))
    .join("-");

  return [
    labelOf(FORMAT_OPTIONS, format),
    labelOf(BOW_TYPE_OPTIONS, bowType),
    distancePart,
  ]
    .filter((part) => part !== "")
    .join(" / ");
}

function presetNamePlaceholder(
  roundConfig: RoundConfig,
  distances: Distance[],
): string {
  if (roundConfig.name.trim() !== "") {
    return roundConfig.name;
  }
  return generatePresetName(roundConfig.format, roundConfig.bowType, distances);
}

export function ScorecardClient({
  roundId,
  initialRoundConfig,
  distances: initialDistances,
  initialShots,
  targetFaces,
}: {
  roundId: string;
  initialRoundConfig: RoundConfig;
  distances: Distance[];
  initialShots: Shot[];
  targetFaces: TargetFaceOption[];
}) {
  const [roundConfig, setRoundConfig] =
    useState<RoundConfig>(initialRoundConfig);
  const [distances, setDistances] = useState<Distance[]>(initialDistances);
  const [shots, setShots] = useState<Shot[]>(initialShots);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetSubmitting, setPresetSubmitting] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [editingDistanceIds, setEditingDistanceIds] = useState<Set<string>>(
    new Set(),
  );
  const [addingDistance, setAddingDistance] = useState(false);
  const [distanceError, setDistanceError] = useState<string | null>(null);
  const [keypadOpen, setKeypadOpen] = useState(true);
  // keypadOpenの変化をそのままアンマウントすると格納アニメーションが再生できないため、
  // トランジション終了後に実際にアンマウントするまでの間だけmountedをtrueに保つ。
  const [keypadMounted, setKeypadMounted] = useState(true);
  const [keypadVisible, setKeypadVisible] = useState(true);
  const [position, setPosition] = useState<Position | null>(() =>
    findCurrentPosition(distances, initialShots),
  );
  const [keypadHeight, setKeypadHeight] = useState(KEYPAD_HEIGHT_FALLBACK);
  const keypadRef = useRef<HTMLDivElement>(null);
  const keypadResizeObserverRef = useRef<ResizeObserver | null>(null);
  const rafRef = useRef(0);

  // テンキーのキー数は距離ごとの的によって変わり、高さも連動する。固定値では
  // なく実測値を使うことで、キー数変化時もマス選択のスクロール計算が崩れない。
  const setKeypadNode = useCallback((el: HTMLDivElement | null) => {
    keypadRef.current = el;
    keypadResizeObserverRef.current?.disconnect();
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setKeypadHeight(entry.contentRect.height);
    });
    observer.observe(el);
    keypadResizeObserverRef.current = observer;
  }, []);

  const closeKeypad = useCallback(() => {
    setKeypadOpen(false);
    // positionを残したままだと選択中マスのリング表示（isActive）が消えず、
    // 見た目上フォーカスが外れていないように見えるためクリアする。
    setPosition(null);
    // マス目のボタンだけフォーカスを外す。無条件にblurすると、キーパッド外の
    // 他の入力欄（RoundConfigPanel等）へフォーカスした瞬間にも外れてしまう。
    const active = document.activeElement as HTMLElement | null;
    if (active?.dataset.testid?.startsWith("shot-cell-")) {
      active.blur();
    }
  }, []);

  useEffect(() => {
    if (keypadOpen) {
      setKeypadMounted(true);
      // マウント直後の1フレーム目でtrueにするとブラウザがtranslate-y-fullを描画
      // する前に遷移先の状態へ変わってしまいアニメーションしないため、
      // 1フレーム待ってから変更する。
      const raf1 = requestAnimationFrame(() => {
        const raf2 = requestAnimationFrame(() => setKeypadVisible(true));
        rafRef.current = raf2;
      });
      rafRef.current = raf1;
      return () => cancelAnimationFrame(rafRef.current);
    }

    setKeypadVisible(false);
    const timeout = setTimeout(() => setKeypadMounted(false), 200);
    return () => clearTimeout(timeout);
  }, [keypadOpen]);

  useEffect(() => {
    function handleDocumentClick(e: MouseEvent) {
      // e.targetはハンドラ実行までにアイコンの差し替え等でDOMから外れている
      // ことがあるため、dispatch時点のパスを保持するcomposedPath()で判定する。
      const path = e.composedPath();
      if (keypadRef.current && path.includes(keypadRef.current)) return;
      const clickedShotCell = path.some(
        (el) =>
          el instanceof HTMLElement &&
          el.dataset.testid?.startsWith("shot-cell-"),
      );
      if (clickedShotCell) return;
      closeKeypad();
    }

    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, [closeKeypad]);

  useEffect(() => {
    if (!position) return;
    const testId = `shot-cell-${position.distance.distance_number}-${position.end}-${position.arrow}`;
    const cell = document.querySelector(`[data-testid="${testId}"]`);
    const container = cell?.closest<HTMLElement>(".overflow-y-auto");
    if (!cell || !container) return;

    // マスを選択すれば必ずテンキーが開く前提のため、開閉状態に関わらず常に
    // テンキー分の高さが隠れることを見込んでスクロール位置を計算する
    // （高さ確保用の透明な枠は常にkeypadHeight分の領域を占有している）。
    const margin = 16;
    const cellRect = cell.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const visibleBottom = containerRect.bottom - keypadHeight - margin;

    let delta = 0;
    if (cellRect.bottom > visibleBottom) {
      delta = cellRect.bottom - visibleBottom;
    } else if (cellRect.top < containerRect.top + margin) {
      delta = cellRect.top - (containerRect.top + margin);
    }

    if (delta !== 0) {
      container.scrollBy({ top: delta, behavior: "smooth" });
    }
  }, [position, keypadHeight]);

  const total = shots.reduce((sum, s) => sum + s.score_int, 0);
  const xCount = shots.filter((s) => s.score_str === "X").length;
  const tenCount = shots.filter((s) => s.score_str === "10").length;

  const distanceIdsWithShots = new Set(shots.map((s) => s.distance_id));

  function targetFaceOf(targetFaceId: string) {
    return targetFaces.find((f) => f.id === targetFaceId);
  }

  function toggleDistanceEditing(distanceId: string) {
    setEditingDistanceIds((prev) => {
      const next = new Set(prev);
      if (next.has(distanceId)) {
        next.delete(distanceId);
      } else {
        next.add(distanceId);
      }
      return next;
    });
  }

  async function handleAddDistance() {
    if (addingDistance) return;
    setAddingDistance(true);
    setDistanceError(null);

    const result = await addDistance({ roundId });
    if ("error" in result) {
      setDistanceError(result.error);
      setAddingDistance(false);
      return;
    }

    setDistances((prev) => [
      ...prev,
      {
        id: result.distance.id,
        distance_number: result.distance.distanceNumber,
        distance: result.distance.distance,
        total_ends: result.distance.totalEnds,
        arrows_per_end: result.distance.arrowsPerEnd,
        target_face_id: result.distance.targetFaceId,
        is_marked: result.distance.isMarked,
      },
    ]);
    // 追加した距離はすぐ編集できるよう、編集パネルを展開しておく。
    setEditingDistanceIds((prev) => new Set(prev).add(result.distance.id));
    setAddingDistance(false);
  }

  function handleDistanceSaved(updated: DistanceConfig) {
    const previous = distances.find((d) => d.id === updated.id);
    // 距離（m）はマス構成にも得点判定にも影響しないため、変更してもこの距離の
    // undo/redo履歴は壊れない。的・総エンド数・エンドあたりの本数が変わった
    // 場合のみ、この距離のマスを指す履歴を破棄する（他の距離の履歴は無関係
    // なので残す）。
    const structureChanged =
      !previous ||
      previous.total_ends !== updated.totalEnds ||
      previous.arrows_per_end !== updated.arrowsPerEnd ||
      previous.target_face_id !== updated.targetFaceId;

    setDistances((prev) =>
      prev.map((d) =>
        d.id === updated.id
          ? {
              ...d,
              distance: updated.distance,
              total_ends: updated.totalEnds,
              arrows_per_end: updated.arrowsPerEnd,
              target_face_id: updated.targetFaceId,
              is_marked: updated.isMarked,
            }
          : d,
      ),
    );
    toggleDistanceEditing(updated.id);
    // 構成（総エンド数・エンドあたりの本数）が変わった可能性があるため、
    // 選択中マスの参照が古いままにならないようフォーカスを一旦クリアする。
    setPosition(null);
    if (structureChanged) {
      setUndoStack((prev) => prev.filter((e) => e.distanceId !== updated.id));
      setRedoStack((prev) => prev.filter((e) => e.distanceId !== updated.id));
    }
  }

  async function handleSavePreset() {
    if (presetSubmitting) return;
    setPresetSubmitting(true);
    setPresetError(null);

    const name =
      presetName.trim() !== ""
        ? presetName.trim()
        : presetNamePlaceholder(roundConfig, distances);
    const result = await saveRoundAsPreset({ roundId, name });
    if (result?.error) {
      setPresetError(result.error);
      setPresetSubmitting(false);
      return;
    }

    setPresetSubmitting(false);
    setPresetDialogOpen(false);
    setPresetName("");
  }

  function handleDistanceDeleted(distanceId: string) {
    setDistances((prev) => prev.filter((d) => d.id !== distanceId));
    setShots((prev) => prev.filter((s) => s.distance_id !== distanceId));
    // 削除された距離のマスを指す履歴だけを破棄する。他の距離の履歴は
    // 引き続き有効なので残す。
    setUndoStack((prev) => prev.filter((e) => e.distanceId !== distanceId));
    setRedoStack((prev) => prev.filter((e) => e.distanceId !== distanceId));
    setEditingDistanceIds((prev) => {
      const next = new Set(prev);
      next.delete(distanceId);
      return next;
    });
    if (position?.distance.id === distanceId) {
      setPosition(null);
    }
  }

  function findShot(
    distanceId: string,
    endNumber: number,
    arrowNumber: number,
  ): Shot | null {
    return (
      shots.find(
        (s) =>
          s.distance_id === distanceId &&
          s.end_number === endNumber &&
          s.arrow_number === arrowNumber,
      ) ?? null
    );
  }

  // 指定マスの状態をshotへ反映する（サーバーへの反映＋ローカルstateの更新）。
  // undo/redoはこの適用処理を、記録時とは逆方向・同方向にそれぞれ1回呼ぶだけで実現する。
  async function applyShot(
    distanceId: string,
    endNumber: number,
    arrowNumber: number,
    shot: Shot | null,
  ): Promise<string | undefined> {
    const result = shot
      ? await recordShot({
          distanceId,
          endNumber,
          arrowNumber,
          scoreStr: shot.score_str,
          scoreInt: shot.score_int,
        })
      : await clearShot({ distanceId, endNumber, arrowNumber });

    if (result?.error) return result.error;

    setShots((prev) => {
      const filtered = prev.filter(
        (s) =>
          !(
            s.distance_id === distanceId &&
            s.end_number === endNumber &&
            s.arrow_number === arrowNumber
          ),
      );
      return shot ? [...filtered, shot] : filtered;
    });
  }

  async function handleScore(scoreStr: string, scoreInt: number) {
    if (!position || submitting) return;
    setSubmitting(true);
    setError(null);

    const { distance, end, arrow } = position;
    const prevShot = findShot(distance.id, end, arrow);
    const nextShot: Shot = {
      distance_id: distance.id,
      end_number: end,
      arrow_number: arrow,
      score_str: scoreStr,
      score_int: scoreInt,
    };

    const errorMessage = await applyShot(distance.id, end, arrow, nextShot);
    if (errorMessage) {
      setError(errorMessage);
      setSubmitting(false);
      return;
    }

    setUndoStack((prev) => [
      ...prev,
      {
        distanceId: distance.id,
        endNumber: end,
        arrowNumber: arrow,
        prevShot,
        nextShot,
      },
    ]);
    setRedoStack([]);
    setPosition(stepPosition(distances, position, 1));
    setSubmitting(false);
  }

  async function handleClear() {
    if (!position || submitting) return;
    setSubmitting(true);
    setError(null);

    const { distance, end, arrow } = position;
    const prevShot = findShot(distance.id, end, arrow);

    const errorMessage = await applyShot(distance.id, end, arrow, null);
    if (errorMessage) {
      setError(errorMessage);
      setSubmitting(false);
      return;
    }

    if (prevShot) {
      setUndoStack((prev) => [
        ...prev,
        {
          distanceId: distance.id,
          endNumber: end,
          arrowNumber: arrow,
          prevShot,
          nextShot: null,
        },
      ]);
      setRedoStack([]);
    }
    setPosition(stepPosition(distances, position, -1) ?? position);
    setSubmitting(false);
  }

  // 取り消した/やり直したマスへフォーカスを移動し、何が変わったか見えるようにする。
  function focusHistoryEntry(entry: HistoryEntry) {
    const distance = distances.find((d) => d.id === entry.distanceId);
    if (!distance) return;
    setKeypadMounted(true);
    setPosition({ distance, end: entry.endNumber, arrow: entry.arrowNumber });
    setKeypadOpen(true);
  }

  async function handleUndo() {
    const entry = undoStack.at(-1);
    if (!entry || submitting) return;
    setSubmitting(true);
    setError(null);

    const errorMessage = await applyShot(
      entry.distanceId,
      entry.endNumber,
      entry.arrowNumber,
      entry.prevShot,
    );
    if (errorMessage) {
      setError(errorMessage);
      setSubmitting(false);
      return;
    }

    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, entry]);
    focusHistoryEntry(entry);
    setSubmitting(false);
  }

  async function handleRedo() {
    const entry = redoStack.at(-1);
    if (!entry || submitting) return;
    setSubmitting(true);
    setError(null);

    const errorMessage = await applyShot(
      entry.distanceId,
      entry.endNumber,
      entry.arrowNumber,
      entry.nextShot,
    );
    if (errorMessage) {
      setError(errorMessage);
      setSubmitting(false);
      return;
    }

    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, entry]);
    focusHistoryEntry(entry);
    setSubmitting(false);
  }

  function selectCell(distance: Distance, end: number, arrow: number) {
    // 格納後に再度開く場合、keypadMountedがマウント用useEffectを経由して
    // 遅れて反映されると、スクロール計算がkeypadRef未接続のまま実行されて
    // しまうため、ここで同期的にマウント済みにしておく。
    setKeypadMounted(true);
    setPosition({ distance, end, arrow });
    setKeypadOpen(true);
  }

  return (
    <main className="flex min-h-full flex-col">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-8">
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/rounds"
            className="inline-flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
            一覧へ戻る
          </Link>
          <Dialog
            open={presetDialogOpen}
            onOpenChange={(open) => {
              setPresetDialogOpen(open);
              if (!open) {
                setPresetName("");
                setPresetError(null);
              }
            }}
          >
            <DialogTrigger
              data-testid="save-as-preset-trigger"
              className={buttonVariants({ variant: "default", size: "sm" })}
            >
              プリセット保存
            </DialogTrigger>
            <DialogContent>
              <div className="flex flex-col gap-3">
                <h2 className="font-medium text-sm">
                  現在の構成をプリセットとして保存しますか？
                </h2>
                <div className="flex flex-col gap-1 text-muted-foreground text-sm">
                  {[...distances]
                    .sort((a, b) => a.distance_number - b.distance_number)
                    .map((d) => {
                      const face = targetFaces.find(
                        (f) => f.id === d.target_face_id,
                      );
                      const rings =
                        face?.target_face_spots[0]?.target_face_rings ?? [];

                      return (
                        <div
                          key={d.id}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="flex items-center gap-2">
                            {[
                              d.distance !== null ? `${d.distance}m` : null,
                              roundConfig.format === "field"
                                ? d.is_marked
                                  ? "Marked"
                                  : "Unmarked"
                                : null,
                            ]
                              .filter((part): part is string => part !== null)
                              .join(" / ")}
                            <TargetFaceIcon rings={rings} />
                            {face ? `${face.size}cm` : "的未設定"}
                          </span>
                          <span className="shrink-0">
                            {d.arrows_per_end}本×{d.total_ends}エンド
                          </span>
                        </div>
                      );
                    })}
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="save-as-preset-name"
                    className="text-muted-foreground text-xs"
                  >
                    プリセット名
                  </label>
                  <Input
                    id="save-as-preset-name"
                    data-testid="save-as-preset-name"
                    placeholder={presetNamePlaceholder(roundConfig, distances)}
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                  />
                </div>
                {presetError && (
                  <p className="text-destructive text-sm">{presetError}</p>
                )}
                <Button
                  type="button"
                  disabled={presetSubmitting}
                  data-testid="save-as-preset-confirm"
                  onClick={handleSavePreset}
                >
                  保存
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <RoundConfigPanel
          roundId={roundId}
          initial={initialRoundConfig}
          onSaved={setRoundConfig}
        />
        <div
          data-testid="round-summary"
          className="flex items-baseline justify-center gap-2 rounded-xl border bg-card p-4 text-card-foreground shadow-sm"
        >
          <span className="font-heading text-2xl font-semibold">
            合計{total}
          </span>
          <span className="text-muted-foreground text-sm">
            X: {xCount} / 10: {tenCount}
          </span>
        </div>

        <div className="flex flex-col gap-4">
          {distances.map((d) => {
            const distanceShots = shots.filter((s) => s.distance_id === d.id);
            const distanceTotal = distanceShots.reduce(
              (sum, s) => sum + s.score_int,
              0,
            );
            const distanceXCount = distanceShots.filter(
              (s) => s.score_str === "X",
            ).length;
            const distanceTenCount = distanceShots.filter(
              (s) => s.score_str === "10",
            ).length;
            const face = targetFaceOf(d.target_face_id);

            return (
              <div
                key={d.id}
                className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm"
              >
                <div data-testid={`distance-summary-${d.distance_number}`}>
                  <button
                    type="button"
                    data-testid={`distance-config-toggle-${d.distance_number}`}
                    onClick={() => toggleDistanceEditing(d.id)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-muted-foreground text-xs"
                  >
                    <span className="flex items-center gap-2">
                      {[
                        d.distance !== null ? `${d.distance}m` : null,
                        roundConfig.format === "field"
                          ? d.is_marked
                            ? "Marked"
                            : "Unmarked"
                          : null,
                      ]
                        .filter((part): part is string => part !== null)
                        .join(" / ")}
                      {face ? (
                        <TargetFaceTile
                          spots={face.target_face_spots}
                          sizeCm={face.size}
                          pixelSize={32}
                        />
                      ) : (
                        "的未設定"
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="flex flex-col items-end leading-tight">
                        <span>{d.arrows_per_end}本</span>
                        <span>{d.total_ends}エンド</span>
                      </span>
                      <ChevronRight className="size-4 shrink-0" />
                    </span>
                  </button>
                  {editingDistanceIds.has(d.id) && (
                    <DistanceEditFields
                      distance={{
                        id: d.id,
                        distanceNumber: d.distance_number,
                        distance: d.distance,
                        totalEnds: d.total_ends,
                        arrowsPerEnd: d.arrows_per_end,
                        targetFaceId: d.target_face_id,
                        isMarked: d.is_marked,
                      }}
                      hasShots={distanceIdsWithShots.has(d.id)}
                      targetFaces={targetFaces}
                      roundFormat={roundConfig.format}
                      onSaved={handleDistanceSaved}
                      onDeleted={() => handleDistanceDeleted(d.id)}
                      onOpenChange={(open) => {
                        if (!open) toggleDistanceEditing(d.id);
                      }}
                    />
                  )}
                  <div className="flex items-baseline justify-between gap-2 border-t border-b px-3 py-2 text-muted-foreground text-xs">
                    <span className="text-foreground text-sm font-semibold">
                      小計{distanceTotal}
                    </span>
                    <span>
                      X: {distanceXCount} / 10: {distanceTenCount}
                    </span>
                  </div>
                </div>
                <div className="divide-y">
                  {Array.from({ length: d.total_ends }, (_, i) => i + 1).map(
                    (end) => {
                      const endShots = shots.filter(
                        (s) => s.distance_id === d.id && s.end_number === end,
                      );
                      const subtotal = endShots.reduce(
                        (sum, s) => sum + s.score_int,
                        0,
                      );
                      const hasAnyShot = endShots.length > 0;

                      return (
                        <div key={end} className="flex items-stretch">
                          <div className="flex w-8 shrink-0 items-center justify-center border-r text-muted-foreground text-xs">
                            {end}
                          </div>
                          <div
                            className="grid flex-1 divide-x"
                            style={{
                              gridTemplateColumns: `repeat(${d.arrows_per_end}, minmax(0, 1fr))`,
                            }}
                          >
                            {Array.from(
                              { length: d.arrows_per_end },
                              (_, i) => i + 1,
                            ).map((arrow) => {
                              const shot = endShots.find(
                                (s) => s.arrow_number === arrow,
                              );
                              const isActive =
                                position?.distance.id === d.id &&
                                position.end === end &&
                                position.arrow === arrow;
                              const color = shot
                                ? paleTone(
                                    ringColorFor(
                                      targetFaceOf(d.target_face_id),
                                      shot.score_str,
                                    ),
                                  )
                                : null;

                              return (
                                <button
                                  key={arrow}
                                  type="button"
                                  data-testid={`shot-cell-${d.distance_number}-${end}-${arrow}`}
                                  onClick={() => selectCell(d, end, arrow)}
                                  className={cn(
                                    "flex min-h-10 items-center justify-center py-2 text-base font-medium transition-colors hover:bg-muted/60",
                                    isActive &&
                                      "bg-primary/10 text-primary ring-2 ring-primary ring-inset",
                                  )}
                                  style={
                                    color
                                      ? {
                                          backgroundColor: color.bg,
                                          color: color.fg,
                                        }
                                      : undefined
                                  }
                                >
                                  {shot?.score_str ?? ""}
                                </button>
                              );
                            })}
                          </div>
                          <div
                            data-testid={`end-subtotal-${d.distance_number}-${end}`}
                            className="flex min-h-10 w-14 shrink-0 items-center justify-center border-l text-muted-foreground text-base"
                          >
                            {hasAnyShot ? `${subtotal}` : ""}
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            disabled={addingDistance}
            data-testid="add-distance-button"
            onClick={handleAddDistance}
            className="border-dashed"
          >
            <Plus />
            距離を追加
          </Button>
          {distanceError && (
            <p className="text-destructive text-sm">{distanceError}</p>
          )}
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>

      {position && (
        // 高さ確保用の透明な枠。常にkeypadHeight分の領域をスクロール可能域として
        // 確保しておくことで、展開アニメーションの進み具合に関わらずスクロール
        // 計算が安定する。クリックも透過させ、実際の操作は下の実体側で受ける。
        <div
          className="sticky bottom-0 pointer-events-none"
          style={{ height: keypadHeight }}
        >
          {keypadMounted && (
            <div
              ref={setKeypadNode}
              className={cn(
                "pointer-events-auto absolute inset-x-0 bottom-0 border-t bg-card shadow-lg transition-transform duration-200",
                keypadVisible ? "translate-y-0" : "translate-y-full",
              )}
            >
              <div className="mx-auto max-w-xl">
                <button
                  type="button"
                  data-testid="keypad-toggle"
                  onClick={closeKeypad}
                  aria-label="テンキーを閉じる"
                  className="flex w-full items-center justify-center py-1.5 text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown className="size-5" />
                </button>
                <div className="flex flex-col gap-2 p-4 pt-0">
                  <div className="grid grid-cols-4 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      disabled={submitting || undoStack.length === 0}
                      data-testid="score-button-undo"
                      aria-label="一つ戻る"
                      onClick={handleUndo}
                    >
                      <Undo />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="col-span-2"
                      disabled={submitting}
                      data-testid="score-button-clear"
                      onClick={handleClear}
                    >
                      クリア
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      disabled={submitting || redoStack.length === 0}
                      data-testid="score-button-redo"
                      aria-label="一つ進む"
                      onClick={handleRedo}
                    >
                      <Redo />
                    </Button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {keypadKeysFor(
                      targetFaceOf(position.distance.target_face_id),
                    ).map((b) => (
                      <Button
                        key={b.label}
                        type="button"
                        variant="outline"
                        size="lg"
                        disabled={submitting}
                        data-testid={`score-button-${b.label}`}
                        onClick={() => handleScore(b.scoreStr, b.scoreInt)}
                        // 背景色をstyleで直接指定するとhover:bg-muted等のクラスは
                        // 上書きされて効かなくなる。brightnessフィルターは黒（#231F20）
                        // のような暗い色では変化が知覚できないため、明暗どちらの背景
                        // でも均一に視認できるグレー半透明のオーバーレイをinset
                        // box-shadowで重ねてホバー/押下の視覚フィードバックとする。
                        className="transition-shadow hover:shadow-[inset_0_0_0_999px_rgba(128,128,128,0.25)] active:shadow-[inset_0_0_0_999px_rgba(128,128,128,0.35)]"
                        style={{
                          backgroundColor: b.bg,
                          color: b.fg,
                        }}
                      >
                        {b.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
