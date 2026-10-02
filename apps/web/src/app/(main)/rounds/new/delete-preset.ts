import { sessionFailureMessage } from "@/features/auth/errors";
import { classifySession } from "@/features/auth/session-state";
import { createClient } from "@/lib/supabase/client";

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
  presetId,
  isMounted,
}: {
  presetId: string;
  isMounted: () => boolean;
}): Promise<DeletePresetResult> {
  try {
    const supabase = createClient();
    const state = classifySession(await supabase.auth.getSession());

    if (!isMounted()) return { status: "discarded" };

    if (state.status !== "authenticated") {
      return { status: "failed", error: sessionFailureMessage(state) };
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
    return {
      status: "failed",
      error: "通信エラーが発生しました。しばらくしてから再度お試しください。",
    };
  }
}
