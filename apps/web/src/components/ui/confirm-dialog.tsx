"use client";

import { BusyButton } from "@/components/ui/busy-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

// window.confirmではブラウザ標準の素っ気ないOK/キャンセルしか出せず、何が
// 失われるかを十分に説明できない。距離削除・ラウンド削除に加え、今後追加
// される影響の大きい削除（チーム等）でも同じ見た目で確認できるよう、
// アプリのデザインに沿った共通コンポーネントとして用意する。
// 確認後はすぐ閉じる。操作の列に積んで完了を待たない操作に使う。
export function ConfirmDialog({
  open,
  onOpenChange,
  description,
  confirmLabel = "削除",
  confirmVariant = "destructive",
  onConfirm,
  nested = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  description: string;
  confirmLabel?: string;
  // 削除など破壊的でない確認(入力の完了など)では"default"にする。
  confirmVariant?: "destructive" | "default";
  onConfirm: () => void;
  // 他のDialogの中から開かれる場合はtrueにする（距離削除確認等）。
  // 詳細はDialogContentのnestedの説明を参照。
  nested?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent nested={nested}>
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
              variant={confirmVariant}
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

// 破壊的だが低頻度・オフライン対応が不要な操作（プリセット削除、サインアウト等）
// 向け。ConfirmDialogと異なり、確認後もリクエスト完了までダイアログを開いた
// まま待ち、失敗時はダイアログ内にエラーを表示して再試行できるようにする。
// 距離削除・スコア記録のようにオフラインでの動作が必要な操作には使わない
// （そちらは楽観的UI・操作の列を使う）。
// 実行中かとエラーは呼び出し側が持ち、この部品は表現だけを担う。
// 二重実行の拒否も呼び出し側が行う（この部品は確認の押下をそのまま知らせる）。
export function BlockingConfirmDialog({
  open,
  onOpenChange,
  description,
  confirmLabel = "削除",
  onConfirm,
  busy,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  // 実行中は、背景クリック・Escとキャンセルでは閉じさせず、ボタンを無効の表示にする。
  busy: boolean;
  error: string | null;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <div className="flex flex-col gap-4">
          <p className="text-sm">{description}</p>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <div className="flex justify-end gap-2">
            <BusyButton
              type="button"
              variant="outline"
              busy={busy}
              spinner={false}
              data-testid="confirm-dialog-cancel"
              onClick={() => {
                if (busy) return;
                onOpenChange(false);
              }}
            >
              キャンセル
            </BusyButton>
            <BusyButton
              type="button"
              variant="destructive"
              busy={busy}
              data-testid="confirm-dialog-confirm"
              onClick={onConfirm}
            >
              {confirmLabel}
            </BusyButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
