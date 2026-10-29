import {
  NETWORK_ERROR_MESSAGE,
  type SessionReader,
  unconfirmedMessage,
} from "@/features/auth";
import { createClient } from "@/lib/supabase/infrastructure/client";

// deleted: 削除できた。
// failed: 削除できず、画面に表示するエラーメッセージがある。
// discarded: 完了を待つ間に画面がアンマウントされたため、結果を破棄した。
type DeletePresetResult =
  | { status: "deleted" }
  | { status: "failed"; error: string }
  | { status: "discarded" };

// BlockingConfirmDialogの確認後に呼ぶ個人プリセットの削除。
// 削除成功後の一覧と選択状態の更新は、呼び出し元の画面が担う。
export async function deletePersonalPreset({
  sessionReader,
  presetId,
  isMounted,
}: {
  sessionReader: SessionReader;
  presetId: string;
  isMounted: () => boolean;
}): Promise<DeletePresetResult> {
  try {
    const supabase = createClient();
    const reading = await sessionReader.readSession();

    if (!isMounted()) return { status: "discarded" };

    if (reading.status !== "authenticated") {
      return { status: "failed", error: unconfirmedMessage(reading.status) };
    }

    const { error } = await supabase
      .from("preset_rounds")
      .delete()
      .eq("id", presetId);

    if (!isMounted()) return { status: "discarded" };

    if (error) {
      return { status: "failed", error: error.message };
    }

    return { status: "deleted" };
  } catch {
    if (!isMounted()) return { status: "discarded" };
    return { status: "failed", error: NETWORK_ERROR_MESSAGE };
  }
}
