"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

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
