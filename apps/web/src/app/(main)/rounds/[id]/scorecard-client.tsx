"use client";

import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Plus,
  Redo,
  Undo,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BlockingConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getLocalIdentity } from "@/features/auth/local-identity";
import { useHydrated } from "@/hooks/use-hydrated";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { DistanceInfo } from "../_shared/preset-info";
import type { DistanceConfig } from "./distance-config";
import {
  DistanceEditFields,
  type TargetFaceOption,
} from "./distance-config-row";
import { KeypadPanel } from "./keypad-panel";
import type { RoundConfig } from "./round-config";
import { RoundConfigPanel } from "./round-config-panel";
import { SavePresetDialog } from "./save-preset-dialog";
import {
  changesDistanceStructure,
  distanceToAdd,
  removeDistance,
  removeDistanceShots,
  updateDistance,
} from "./scorecard-distances";
import {
  type Cell,
  cellLabel,
  cellOf,
  clearHistoryEntry,
  discardDistanceEntries,
  findCurrentPosition,
  type HistoryEntry,
  type Position,
  positionAfterClear,
  positionAfterScore,
  positionAfterSelect,
  positionOfCell,
  pushHistory,
  redoHistory,
  replaceShot,
  scoreHistoryEntry,
  shotEnqueueInput,
  undoHistory,
} from "./scorecard-input";
import { restorePendingOperations } from "./scorecard-pending";
import {
  distanceNumber,
  endSubtotal,
  type ScoringTargetFace,
  scoreKeysFor,
  summarizeDistance,
  summarizeRound,
} from "./scorecard-scoring";
import type { Distance, Shot } from "./scorecard-types";
import { loadPendingOperations } from "./sync-outbox";
import { syncShots } from "./sync-shots";
import { useSyncQueue } from "./use-sync-queue";

// テンキーは中身のキー数が距離の的ごとに変わるため実測高さを使う。この値は
// ResizeObserverが初回計測を終えるまでの暫定値。
const KEYPAD_HEIGHT_FALLBACK = 220;

function contrastText(hex: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#231F20" : "#FFFFFF";
}

// マス目に記録済みの点数の実際のリング色を、テンキーと同じキー構成から引く。
// Mや的に無い点数は、的の外を表すM（キー構成の末尾）の色とする。
function ringColorFor(
  targetFace: ScoringTargetFace | undefined,
  scoreStr: string,
): string {
  const keys = scoreKeysFor(targetFace);
  const key =
    keys.find((k) => k.scoreStr === scoreStr) ?? keys[keys.length - 1];
  return key.color;
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
  const router = useRouter();
  const [roundConfig, setRoundConfig] =
    useState<RoundConfig>(initialRoundConfig);
  const [distances, setDistances] = useState<Distance[]>(initialDistances);
  const [shots, setShots] = useState<Shot[]>(initialShots);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const sync = useSyncQueue(roundId, () => router.refresh());
  const mountedRef = useRef(true);

  useEffect(() => {
    setRoundConfig(initialRoundConfig);
    setDistances(initialDistances);
    setShots(initialShots);
  }, [initialDistances, initialRoundConfig, initialShots]);

  useEffect(() => {
    void loadPendingOperations(roundId, getLocalIdentity()).then((pending) => {
      const restore = restorePendingOperations(
        pending.map(({ operation }) => operation),
      );
      // 読み込み中に初期値の反映や入力で状態が変わっていても、その最新の状態へ反映する。
      setRoundConfig(restore.roundConfig);
      setDistances(restore.distances);
      setShots(restore.shots);
      if (restore.leaveRound) router.replace("/rounds");
    });
  }, [roundId, router]);

  useEffect(() => {
    // Strict Modeの開発時二重実行（マウント→クリーンアップ→再マウント）に
    // 対応するため、マウント時にも明示的にtrueへ戻す。
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [syncErrorsOpen, setSyncErrorsOpen] = useState(false);
  const [deleteRoundConfirmOpen, setDeleteRoundConfirmOpen] = useState(false);
  const hydrated = useHydrated();
  const [editingDistanceIds, setEditingDistanceIds] = useState<Set<string>>(
    new Set(),
  );
  // マス目の選択有無（position）がそのままテンキーの開閉状態であり、
  // 別のstateとして二重管理しない。selectCell等で常にpositionとセットで
  // 更新していた旧keypadOpenを廃止し、ここから直接導出する。
  const [position, setPosition] = useState<Position | null>(() =>
    findCurrentPosition(distances, initialShots),
  );
  // keypadOpen（=position有無）の変化をそのままアンマウントすると格納
  // アニメーションが再生できないため、トランジション終了後に実際に
  // アンマウントするまでの間だけmountedをtrueに保つ。
  const [keypadMounted, setKeypadMounted] = useState(position !== null);
  const [keypadVisible, setKeypadVisible] = useState(position !== null);
  const [keypadHeight, setKeypadHeight] = useState(KEYPAD_HEIGHT_FALLBACK);
  const keypadRef = useRef<HTMLDivElement>(null);
  const keypadResizeObserverRef = useRef<ResizeObserver | null>(null);
  const rafRef = useRef(0);
  // 横向きではテンキーをスコア領域の隣に並ぶ側パネルとして<main>の外側に、
  // 縦向きでは<main>内蔵のボトムシートとして描画を完全に分ける（CSSの
  // 出し分けではなくJSで判定し、どちらか一方だけをマウントする）。これに
  // より、縦向きのボトムシートはposition:fixedにする必要が無くなり、常に
  // <main>の内側（＝レフトパネルより右のコンテンツ領域）に収まるため、
  // レフトパネルの実占有幅を気にする必要が一切無くなる。
  const [isLandscape, setIsLandscape] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(orientation: landscape)");
    const update = () => setIsLandscape(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  // 格納アニメーション中もテンキーの中身（点数ボタン）を表示し続けられる
  // よう、positionがnullになった後も直近のpositionを保持しておく。
  const lastPositionRef = useRef<Position | null>(position);
  if (position) lastPositionRef.current = position;
  const displayPosition = position ?? lastPositionRef.current;

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
    // positionを残したままだと選択中マスのリング表示（isActive）が消えず、
    // 見た目上フォーカスが外れていないように見えるためクリアする。
    // これによりkeypadShouldBeOpen（=position有無）もfalseになり、
    // 下の格納アニメーション用useEffectが発火する。
    setPosition(null);
    // マス目のボタンだけフォーカスを外す。無条件にblurすると、キーパッド外の
    // 他の入力欄（RoundConfigPanel等）へフォーカスした瞬間にも外れてしまう。
    const active = document.activeElement as HTMLElement | null;
    if (active?.dataset.testid?.startsWith("shot-cell-")) {
      active.blur();
    }
  }, []);

  const keypadShouldBeOpen = position !== null;

  useEffect(() => {
    if (keypadShouldBeOpen) {
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
  }, [keypadShouldBeOpen]);

  useEffect(() => {
    if (!position) return;
    const testId = `shot-cell-${distanceNumber(distances, position.distance.id)}-${position.end}-${position.arrow}`;
    const cell = document.querySelector(`[data-testid="${testId}"]`);
    const container = cell?.closest<HTMLElement>(".overflow-y-auto");
    if (!cell || !container) return;

    // マスを選択すれば必ずテンキーが開く前提のため、開閉状態に関わらず常に
    // テンキー分の高さが隠れることを見込んでスクロール位置を計算する
    // （高さ確保用の透明な枠は常にkeypadHeight分の領域を占有している）。
    // 横向きではテンキーは横に並ぶ側パネルで、keypadHeightは列いっぱいに
    // 伸びたパネル自身の高さ（コンテンツと無関係な値）になり、コンテンツを
    // 覆い隠すことも無いため、この補正は縦向き（isLandscape=false、
    // ボトムシート表示時）でのみ適用する。
    const margin = 16;
    const cellRect = cell.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const visibleBottom =
      containerRect.bottom - (isLandscape ? 0 : keypadHeight) - margin;

    let delta = 0;
    if (cellRect.bottom > visibleBottom) {
      delta = cellRect.bottom - visibleBottom;
    } else if (cellRect.top < containerRect.top + margin) {
      delta = cellRect.top - (containerRect.top + margin);
    }

    if (delta !== 0) {
      container.scrollBy({ top: delta, behavior: "smooth" });
    }
  }, [position, keypadHeight, isLandscape, distances]);

  const roundSummary = summarizeRound(distances, targetFaces, shots);

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

  function handleAddDistance() {
    // IDは楽観的UIのためここで確定し、そのままキューに積む。
    const { distance: newDistance, enqueueInput } = distanceToAdd(distances, {
      id: crypto.randomUUID(),
      eventId: crypto.randomUUID(),
      roundId,
    });
    setDistances((prev) => [...prev, newDistance]);
    // 追加した距離はすぐ編集できるよう、編集パネルを展開しておく。
    setEditingDistanceIds((prev) => new Set(prev).add(newDistance.id));
    sync.enqueue(enqueueInput);
  }

  function handleDistanceSaved(updated: DistanceConfig) {
    const structureChanged = changesDistanceStructure(distances, updated);
    setDistances((prev) => updateDistance(prev, updated.id, updated));
    toggleDistanceEditing(updated.id);
    // 構成（総エンド数・エンドあたりの本数）が変わった可能性があるため、
    // 選択中マスの参照が古いままにならないようフォーカスを一旦クリアする。
    setPosition(null);
    if (structureChanged) {
      setUndoStack((prev) => discardDistanceEntries(prev, updated.id));
      setRedoStack((prev) => discardDistanceEntries(prev, updated.id));
    }
  }

  async function handleDeleteRound(): Promise<{ error: string } | undefined> {
    // BlockingConfirmDialog向けの操作のため、他の書き込みと異なりオフライン
    // 対応の送信キューは使わず、完了を待ってから遷移する（confirm-dialog.tsx
    // のBlockingConfirmDialogのコメントを参照）。
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (!mountedRef.current) return;

      if (!user) {
        return { error: "サインインが必要です。" };
      }

      const { error } = await supabase.rpc("disable_round", {
        p_round_event_id: crypto.randomUUID(),
        p_round_id: roundId,
      });

      if (!mountedRef.current) return;

      if (error) {
        return { error: error.message };
      }

      router.push("/rounds");
    } catch {
      if (!mountedRef.current) return;
      return {
        error: "通信エラーが発生しました。しばらくしてから再度お試しください。",
      };
    }
  }

  function handleDistanceDeleted(distanceId: string) {
    setDistances((prev) => removeDistance(prev, distanceId));
    setShots((prev) => removeDistanceShots(prev, distanceId));
    setUndoStack((prev) => discardDistanceEntries(prev, distanceId));
    setRedoStack((prev) => discardDistanceEntries(prev, distanceId));
    setEditingDistanceIds((prev) => {
      const next = new Set(prev);
      next.delete(distanceId);
      return next;
    });
    if (position?.distance.id === distanceId) {
      setPosition(null);
    }
  }

  // 指定マスの状態をshotへ反映する（ローカルstateを即座に更新し、実際の
  // 書き込みは送信キューへ積む）。undo/redoはこの適用処理を、記録時とは
  // 逆方向・同方向にそれぞれ1回呼ぶだけで実現する。
  function applyShot(cell: Cell, shot: Shot | null) {
    setShots((prev) => replaceShot(prev, cell, shot));
    sync.enqueueShot(
      shotEnqueueInput({
        cell,
        shot,
        label: cellLabel(distances, cell),
        eventId: crypto.randomUUID(),
      }),
      syncShots,
    );
  }

  function handleScore(scoreStr: string, scoreInt: number) {
    if (!position) return;

    const entry = scoreHistoryEntry(shots, position, scoreStr, scoreInt);
    applyShot(entry, entry.nextShot);
    const history = pushHistory({ undoStack, redoStack }, entry);
    setUndoStack(history.undoStack);
    setRedoStack(history.redoStack);
    setPosition(positionAfterScore(distances, position));
  }

  function handleClear() {
    if (!position) return;

    // 未記録のマスのクリアも送信キューへ積むが、履歴には残さない。
    const entry = clearHistoryEntry(shots, position);
    applyShot(cellOf(position), null);
    const history = pushHistory({ undoStack, redoStack }, entry);
    setUndoStack(history.undoStack);
    setRedoStack(history.redoStack);
    setPosition(positionAfterClear(distances, position));
  }

  // 取り消した/やり直したマスへフォーカスを移動し、何が変わったか見えるようにする。
  function focusHistoryEntry(entry: HistoryEntry) {
    const next = positionOfCell(distances, entry);
    // 距離削除時にその距離のundo/redo履歴も併せて破棄しているため、
    // 履歴に残っているentryは常に現存する距離を指す（安全策、到達不能）。
    if (!next) return;
    setKeypadMounted(true);
    setPosition(next);
  }

  function handleUndo() {
    const result = undoHistory({ undoStack, redoStack });
    // ボタン自体がundoStack.length===0でdisabledのため、実際には
    // 空の状態で呼ばれることはない（安全策、到達不能）。
    if (!result) return;

    applyShot(result.entry, result.entry.prevShot);
    setUndoStack(result.history.undoStack);
    setRedoStack(result.history.redoStack);
    focusHistoryEntry(result.entry);
  }

  function handleRedo() {
    const result = redoHistory({ undoStack, redoStack });
    // ボタン自体がredoStack.length===0でdisabledのため、実際には
    // 空の状態で呼ばれることはない（安全策、到達不能）。
    if (!result) return;

    applyShot(result.entry, result.entry.nextShot);
    setUndoStack(result.history.undoStack);
    setRedoStack(result.history.redoStack);
    focusHistoryEntry(result.entry);
  }

  function selectCell(distance: Distance, end: number, arrow: number) {
    const next = positionAfterSelect(position, { distance, end, arrow });
    // 格納後に再度開く場合、keypadMountedがマウント用useEffectを経由して
    // 遅れて反映されると、スクロール計算がkeypadRef未接続のまま実行されて
    // しまうため、ここで同期的にマウント済みにしておく。
    if (next) setKeypadMounted(true);
    setPosition(next);
  }

  const keypadButtons = displayPosition && (
    <>
      <div className="grid grid-cols-4 gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="col-span-2 h-12"
          disabled={undoStack.length === 0}
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
          className="h-12"
          disabled={redoStack.length === 0}
          data-testid="score-button-redo"
          aria-label="一つ進む"
          onClick={handleRedo}
        >
          <Redo />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-12 text-lg"
          data-testid="score-button-clear"
          aria-label="クリア"
          onClick={handleClear}
        >
          C
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {scoreKeysFor(
          targetFaceOf(displayPosition.distance.target_face_id),
        ).map((b) => (
          <Button
            key={b.scoreStr}
            type="button"
            variant="outline"
            size="lg"
            data-testid={`score-button-${b.scoreStr}`}
            onClick={() => handleScore(b.scoreStr, b.scoreInt)}
            // 背景色をstyleで直接指定するとhover:bg-muted等のクラスは
            // 上書きされて効かなくなる。brightnessフィルターは黒（#231F20）
            // のような暗い色では変化が知覚できないため、明暗どちらの背景
            // でも均一に視認できるグレー半透明のオーバーレイをinset
            // box-shadowで重ねてホバー/押下の視覚フィードバックとする。
            // マス目（issue #155）はpaleTone()で明度90%に統一された薄い
            // 背景のためMaterial Designのstate layerの目安（8%/12%）で
            // 十分だが、テンキーは彩度の高いベタ色のため同じ%では変化が
            // 知覚できず、実測で確認の上より強い不透明度にしている
            // （issue #286で他の対話的要素の基準を検討する際に再考）。
            // 高さ・文字サイズはタッチターゲット推奨（44〜48px目安）に
            // 合わせてh-12・text-lgへ引き上げる。PCもテンキーとしての
            // 押しやすさ・視認性を優先し、PCの他ボタン（lg標準のh-9）
            // より大きいこの値で統一する。
            className="h-12 text-lg transition-shadow hover:shadow-[inset_0_0_0_999px_rgba(128,128,128,0.25)] active:shadow-[inset_0_0_0_999px_rgba(128,128,128,0.35)]"
            style={{
              backgroundColor: b.color,
              color: contrastText(b.color),
            }}
          >
            {b.scoreStr}
          </Button>
        ))}
      </div>
    </>
  );

  return (
    // h-fullにすることで、この行の高さが常に実際の可視領域（レフトパネルの
    // モバイルヘッダー分を除いた高さ）に一致する。KeypadPanelはこの行の
    // flexアイテムとしてデフォルトのstretchで高さを得ており、この値が
    // 正しくないと横向き時にパネル下端が画面外へはみ出す（h-screen固定に
    // していた際の不具合）。<main>自身がoverflow-y-autoで内部スクロール
    // するため、この行自体は画面の高さを超えて伸びることがなく、
    // KeypadPanelは（sticky等を使わずとも）常に画面内に留まる。
    <div data-hydrated={hydrated} className="flex h-full">
      <main className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col">
          {/* 一覧へ戻る・同期状態は常時見えていてほしい情報のため、
              合計バー（round-summary、top-14でこの下に続けてstickyさせている）
              と同じくページスクロール中ずっと張り付かせる。高さはh-14固定にし、
              round-summary側のtopオフセットと正確に合わせられるようにする。 */}
          <div className="sticky top-0 z-30 grid h-14 grid-cols-[auto_1fr_auto] items-center gap-2 bg-card px-8">
            <Link
              href="/rounds"
              className="inline-flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
              一覧へ戻る
            </Link>
            <button
              type="button"
              data-testid="sync-status"
              onClick={() => {
                if (sync.status === "error") setSyncErrorsOpen(true);
              }}
              className={cn(
                "flex items-center justify-self-center gap-1 text-xs",
                sync.status === "error" &&
                  "font-medium text-destructive underline underline-offset-2",
                (sync.status === "sending" || sync.status === "retrying") &&
                  "text-muted-foreground",
                sync.status === "offline-pending" &&
                  "text-amber-600 dark:text-amber-500",
                sync.status === "synced" &&
                  "text-emerald-600 dark:text-emerald-500",
              )}
            >
              {(sync.status === "sending" || sync.status === "retrying") && (
                <Loader2 className="size-3.5 animate-spin" />
              )}
              {sync.status === "error" && <AlertCircle className="size-3.5" />}
              {sync.status === "offline-pending" && (
                <WifiOff className="size-3.5" />
              )}
              {sync.status === "synced" && <Check className="size-3.5" />}
              {(sync.status === "sending" || sync.status === "retrying") &&
                "同期中…"}
              {sync.status === "error" && "同期失敗"}
              {sync.status === "offline-pending" && "同期保留中"}
              {sync.status === "synced" && "同期済み"}
            </button>
            <div className="flex items-center justify-end gap-2">
              <SavePresetDialog
                roundName={roundConfig.name}
                format={roundConfig.format}
                bowType={roundConfig.bowType}
                distances={distances}
                targetFaces={targetFaces}
              />
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="ラウンドのメニュー"
                  data-testid="round-menu-trigger"
                  className="p-2 text-muted-foreground hover:text-foreground"
                >
                  <MoreHorizontal className="size-5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    data-testid="round-delete"
                    className="text-destructive data-[highlighted]:text-destructive"
                    onClick={() => setDeleteRoundConfirmOpen(true)}
                  >
                    ラウンドを削除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-6 px-8 pb-8">
            <BlockingConfirmDialog
              open={deleteRoundConfirmOpen}
              onOpenChange={setDeleteRoundConfirmOpen}
              description="このラウンドを削除しますか？記録したスコアもすべて失われます。"
              onConfirm={handleDeleteRound}
            />
            {/* 下端は合計バーと接する内部の継ぎ目のため、shadowが下方向へ滲まない
            よう、上・左・右にはみ出す分だけをclip-pathで残す（距離情報の
            トグルボタンと同じ考え方）。 */}
            <div className="rounded-t-xl border-x border-t bg-card text-card-foreground shadow-sm [clip-path:inset(-8px_-8px_0_-8px)]">
              <RoundConfigPanel
                roundId={roundId}
                initial={roundConfig}
                onSaved={setRoundConfig}
                defaultExpanded={initialDistances.length === 0}
                hasUnmarkedDistances={distances.some((d) => !d.is_marked)}
                enqueue={sync.enqueue}
              />
            </div>
            {/* position: stickyは直接の親の高さの範囲でしか張り付かないため、
            RoundConfigPanelと同じ小さいカードの中に置くと、そのカードの
            高さを過ぎた時点で張り付きが外れてしまう（1つのdivに包む案は
            実測で確認済み：張り付きが外れる）。見た目は直前のカードと
            継ぎ目なく繋がって見えるよう角丸・枠線・-mt-6（親のgap-6を打ち
            消す）で調整しつつ、DOM上はこのページ全体（distances一覧を含む
            flex-colコンテナ）の直接の子にすることで、ページ全体をスクロール
            している間ずっと張り付くようにする。RoundConfigPanel側と合わせて
            1枚の結合カードに見せているため、この合計バー自身の外周（左右・
            下端）にもshadowが必要（RoundConfigPanel側のshadowは自分自身の
            外周にしかかからず、この合計バーの下端側は覆えない）。区切り線は
            RoundConfigPanel側のborder-bが持ち、この合計バー自体は
            border-topを持たない。上端はRoundConfigPanelと接する内部の
            継ぎ目のため、shadowが上方向へ滲まないようclip-pathで下・左・右
            にはみ出す分だけを残す。 */}
            <div
              data-testid="round-summary"
              className="-mt-6 sticky top-14 z-20 flex items-baseline justify-end gap-2 rounded-b-xl border bg-card px-3 py-2 shadow-sm [clip-path:inset(0_-8px_-8px_-8px)]"
            >
              <div className="flex items-baseline gap-2">
                {roundSummary.topScores && (
                  <span
                    data-testid="round-top-scores"
                    className="text-muted-foreground text-sm"
                  >
                    {roundSummary.topScores.firstLabel}:{" "}
                    {roundSummary.topScores.firstCount} /{" "}
                    {roundSummary.topScores.secondLabel}:{" "}
                    {roundSummary.topScores.secondCount}
                  </span>
                )}
                <span className="font-heading text-lg font-semibold">
                  合計{roundSummary.total}
                </span>
              </div>
            </div>

            <Dialog open={syncErrorsOpen} onOpenChange={setSyncErrorsOpen}>
              <DialogContent>
                {/* 複数の失敗が同時に溜まっても一度に全部は出さず、最も古い
                  未解決の1件だけを見せる。解決すると次のものが表示される。 */}
                {sync.errors[0] && (
                  <div className="flex flex-col gap-2">
                    <p className="font-heading font-semibold">同期失敗</p>
                    <p className="text-sm">
                      <span className="font-medium">
                        {sync.errors[0].label}
                      </span>
                      ：{sync.errors[0].message}
                    </p>
                  </div>
                )}
              </DialogContent>
            </Dialog>

            <div className="flex flex-col gap-4">
              {distances.map((d) => {
                const displayNumber = distanceNumber(distances, d.id);
                const face = targetFaceOf(d.target_face_id);
                const distanceSummary = summarizeDistance(d.id, face, shots);

                // end行1件分の描画。最終行だけ小計のsticky境界（下記の内側
                // ラッパー）の外に出すため、共通化して2箇所から呼べるようにする。
                const renderEndRow = (end: number) => {
                  const endShots = shots.filter(
                    (s) => s.distance_id === d.id && s.end_number === end,
                  );
                  const subtotal = endSubtotal(endShots);

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
                              data-testid={`shot-cell-${displayNumber}-${end}-${arrow}`}
                              onClick={() => selectCell(d, end, arrow)}
                              className={cn(
                                // 得点色をstyleで直接指定するため、hover:bg-muted等の
                                // クラスは常にそのstyleに上書きされて効かない
                                // （テンキーと同じ問題、issue #155）。明暗どちらの
                                // 背景色でも均一に視認できるグレー半透明のオーバーレイ
                                // をinset box-shadowで重ねてホバー/押下の視覚
                                // フィードバックとする。不透明度はMaterial Design
                                // のstate layerの目安（hover 8%/pressed 12%）に
                                // 合わせる（issue #286で他の対話的要素も含めて
                                // 同じ基準に揃える予定）。
                                "flex min-h-10 items-center justify-center py-2 text-base font-medium transition-shadow hover:shadow-[inset_0_0_0_999px_rgba(128,128,128,0.08)] active:shadow-[inset_0_0_0_999px_rgba(128,128,128,0.12)]",
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
                        data-testid={`end-subtotal-${displayNumber}-${end}`}
                        className="flex min-h-10 w-14 shrink-0 items-center justify-center border-l text-muted-foreground text-base"
                      >
                        {subtotal ?? ""}
                      </div>
                    </div>
                  );
                };

                return (
                  <div
                    key={d.id}
                    data-testid={`distance-summary-${displayNumber}`}
                    className="rounded-xl border bg-card text-card-foreground shadow-sm"
                  >
                    {/* 小計のsticky境界（position: stickyの直接の親）を最終行の
                    手前までにするため、トグル・編集・小計・最終行以外の
                    end行をこの内側ラッパーにまとめる。これにより、最終行は
                    この親の外（下記の兄弟div）に置かれ、小計はこの親の下端
                    ＝最終行の手前でstickyが自然に外れる。 */}
                    <div>
                      {/* 小計（sticky、z-10）が-mt-3.5でこのボタンの下paddingへ
                      食い込むため、区切り線として持たせるこのborder-bが
                      その小計自身の背景に覆われて見えなくならないよう、
                      小計より高いz-indexにしておく（食い込むのは余白部分
                      のみで、この線自体は隠れない）。ただし合計バー
                      （z-20）より高くしてしまうと、スクロールでこのボタン
                      が画面上部を通過する瞬間に合計バー自体を覆ってしまう
                      ため、小計(10)＜このボタン(15)＜合計(20)の順にする。
                      このカード自体の丸角（rounded-xl）がこのボタンの
                      不透明な背景で隠れないよう、上端もrounded-t-xlで
                      揃える。 */}
                      <button
                        type="button"
                        data-testid={`distance-config-toggle-${displayNumber}`}
                        onClick={() => toggleDistanceEditing(d.id)}
                        className="relative z-[15] grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-1 rounded-t-xl border-b bg-card px-3 py-2 text-left text-muted-foreground text-sm"
                      >
                        <DistanceInfo
                          distance={d.distance}
                          isMarked={d.is_marked}
                          format={roundConfig.format}
                          face={face ?? null}
                          arrowsPerEnd={d.arrows_per_end}
                          totalEnds={d.total_ends}
                          trailing={
                            <ChevronRight className="size-4 shrink-0" />
                          }
                        />
                      </button>
                      {editingDistanceIds.has(d.id) && (
                        <DistanceEditFields
                          distance={{
                            id: d.id,
                            distanceNumber: displayNumber,
                            distance: d.distance,
                            totalEnds: d.total_ends,
                            arrowsPerEnd: d.arrows_per_end,
                            targetFaceId: d.target_face_id,
                            isMarked: d.is_marked,
                          }}
                          hasShots={distanceIdsWithShots.has(d.id)}
                          targetFaces={targetFaces}
                          roundFormat={roundConfig.format}
                          roundBowType={roundConfig.bowType}
                          onSaved={handleDistanceSaved}
                          onDeleted={() => handleDistanceDeleted(d.id)}
                          onOpenChange={(open) => {
                            if (!open) toggleDistanceEditing(d.id);
                          }}
                          enqueue={sync.enqueue}
                        />
                      )}
                      {/* 常に上（トグルボタンの余っている下paddingの中）に食い込ま
                      せておく（-mt-3.5、合計バーの丸みの半径分）。上端は枠線を
                      持たせず、区切り線はトグルボタン側のborder-bが担う。これに
                      より通常表示時はトグルボタンの余白に、スクロールで合計バー
                      の下に張り付いた時は合計バー自身に、それぞれ自然に隠れる
                      ため、「張り付いている時だけ隙間ができない」ための余白が
                      どの状態でも無駄な空白に見えない（JS判定不要）。食い込む分
                      だけ上のpaddingを増やし、テキストが隠れないようにする。
                      この小計の親（この内側ラッパー）が最終行を含まないため、
                      最終行の手前でstickyが自然に外れる。 */}
                      <div className="-mt-3.5 sticky top-[88px] z-10 flex items-baseline justify-end gap-2 border-b bg-card px-3 pt-6 pb-2 text-muted-foreground text-xs">
                        {distanceSummary.topScores && (
                          <span
                            data-testid={`distance-top-scores-${displayNumber}`}
                          >
                            {distanceSummary.topScores.firstLabel}:{" "}
                            {distanceSummary.topScores.firstCount} /{" "}
                            {distanceSummary.topScores.secondLabel}:{" "}
                            {distanceSummary.topScores.secondCount}
                          </span>
                        )}
                        <span className="text-foreground text-sm font-semibold">
                          小計{distanceSummary.total}
                        </span>
                      </div>
                      {d.total_ends > 1 && (
                        <div className="divide-y">
                          {Array.from(
                            { length: d.total_ends - 1 },
                            (_, i) => i + 1,
                          ).map((end) => renderEndRow(end))}
                        </div>
                      )}
                    </div>
                    {/* 最終行だけを小計のsticky境界の外に出す。border-tは
                    「1〜N-1行目」グループとの間のdivide-y相当の区切り線。
                    overflow-hiddenはこのend行側だけに付ける。カード直下
                    （親）に付けると、sticky（小計バー）がこの
                    overflow-hiddenを基準にしてしまい、ページ全体の
                    スクロールに追従しなくなるため。 */}
                    <div className="divide-y overflow-hidden rounded-b-xl border-t">
                      {renderEndRow(d.total_ends)}
                    </div>
                  </div>
                );
              })}
              <Button
                type="button"
                variant="outline"
                size="lg"
                data-testid="add-distance-button"
                onClick={handleAddDistance}
                className="h-12 border-dashed"
              >
                <Plus />
                距離を追加
              </Button>
            </div>
          </div>
        </div>

        {!isLandscape && keypadMounted && (
          // 縦向き専用のボトムシート。<main>に内蔵し、position:fixedは
          // 使わない。これにより常にレフトパネルより右のコンテンツ領域に
          // 収まり、レフトパネルの実占有幅を一切気にする必要が無い。
          // 高さ確保用の透明な枠（sticky）を挟むことで、展開アニメーションの
          // 進み具合に関わらずスクロール計算が安定する。keypadMounted基準に
          // することで、格納アニメーション中も確保し続け、スライド完了前に
          // レイアウトが詰まらないようにする。shrink-0は必須: <main>が
          // 横向き側パネルとの高さ調整のためflexアイテム（高さが固定）に
          // なったことで、中身の無いこの枠だけがflexのデフォルトshrinkで
          // 潰され、指定した高さぶんのスクロール領域を確保できなくなる
          // （実際に指定高さの1/10程度まで潰れる不具合があった）。
          <div
            className="sticky bottom-0 z-30 shrink-0 pointer-events-none"
            style={{ height: keypadHeight }}
          >
            <div
              ref={setKeypadNode}
              className={cn(
                "pointer-events-auto absolute inset-x-0 bottom-0 z-30 border-t bg-card shadow-lg transition-transform duration-200",
                // 格納ボタンが本体の上に2rem（-top-8）はみ出しているため、
                // 100%移動だけではそのはみ出し分が画面下端に残って見えて
                // しまう。はみ出し分を上乗せして完全に隠す。
                keypadVisible
                  ? "translate-y-0"
                  : "translate-y-[calc(100%+2rem)]",
              )}
            >
              <div className="relative mx-auto max-w-xl">
                <button
                  type="button"
                  data-testid="keypad-toggle"
                  onClick={closeKeypad}
                  aria-label="テンキーを閉じる"
                  className="-top-8 absolute right-4 flex h-8 w-12 items-center justify-center rounded-t-lg border border-b-0 bg-card text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown className="size-4" />
                </button>
                <div className="flex flex-col gap-2 p-4 pt-4">
                  {keypadButtons}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
      {isLandscape && (
        <KeypadPanel
          mounted={keypadMounted}
          visible={keypadVisible}
          onNodeChange={setKeypadNode}
          onClose={closeKeypad}
        >
          {keypadButtons}
        </KeypadPanel>
      )}
    </div>
  );
}
