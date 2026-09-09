"use client";

import { Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// window.confirmではブラウザ標準の素っ気ないOK/キャンセルしか出せず、何が
// 失われるかを十分に説明できない。距離削除・プリセット削除に加え、今後追加
// される影響の大きい削除（ラウンド・チーム等）でも同じ見た目で確認できるよう、
// アプリのデザインに沿った共通コンポーネントとして用意する。
export function ConfirmDialog({
  open,
  onOpenChange,
  description,
  confirmLabel = "削除",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="flex flex-col gap-4">
          <p className="text-sm">{description}</p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              data-testid="confirm-dialog-cancel"
              onClick={() => onOpenChange(false)}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-testid="confirm-dialog-confirm"
              onClick={() => {
                onOpenChange(false);
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// 破壊的だが低頻度・オフライン対応が不要な操作（ラウンド削除・プリセット削除等）
// 向け。ConfirmDialogと異なり、確認後もリクエスト完了までダイアログを開いた
// まま待ち、失敗時はダイアログ内にエラーを表示して再試行できるようにする
// （サインアウト確認と同じ構造）。距離削除・スコア記録のようにオフラインでの
// 動作が必要な操作には使わない（そちらは楽観的UI・送信キューを使う）。
export function BlockingConfirmDialog({
  open,
  onOpenChange,
  description,
  confirmLabel = "削除",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  description: string;
  confirmLabel?: string;
  onConfirm: () => Promise<{ error: string } | undefined>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 二重送信の判定は同期的なrefで行う。setSubmitting()由来のstateはレンダーを
  // 挟むまで更新されず、連打で2回目の呼び出しが古いsubmitting=falseの
  // クロージャのまま実行されてしまうため、stateだけでは防げない。
  const submittingRef = useRef(false);

  async function handleConfirm() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    const result = await onConfirm();

    if (result?.error) {
      setError(result.error);
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }

    submittingRef.current = false;
    setSubmitting(false);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // 送信中は背景クリック・Escでは閉じさせない。
        if (!next && submittingRef.current) return;
        onOpenChange(next);
        if (!next) setError(null);
      }}
    >
      <DialogContent>
        <div className="flex flex-col gap-4">
          <p className="text-sm">{description}</p>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              aria-disabled={submitting}
              className={cn(submitting && "pointer-events-none opacity-50")}
              data-testid="confirm-dialog-cancel"
              onClick={() => {
                if (submittingRef.current) return;
                onOpenChange(false);
              }}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              variant="destructive"
              aria-disabled={submitting}
              className={cn(submitting && "pointer-events-none opacity-50")}
              data-testid="confirm-dialog-confirm"
              onClick={handleConfirm}
            >
              {submitting && <Loader2 className="size-3.5 animate-spin" />}
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
