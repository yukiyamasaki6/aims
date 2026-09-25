import { createClient } from "@/lib/supabase/client";

// deleted: 削除できた。
// failed: 削除できず、画面に表示するエラーメッセージがある。
// discarded: 完了を待つ間に画面がアンマウントされたため、結果を破棄した。
export type DeleteRoundResult =
  | { status: "deleted" }
  | { status: "failed"; error: string }
  | { status: "discarded" };

// ラウンド一覧とスコアカードの双方から、BlockingConfirmDialogの確認後に呼ぶラウンドの削除。
// 他の書き込みと異なりオフライン対応の送信キューは使わず、完了を待ってから結果を返す（confirm-dialog.tsxのBlockingConfirmDialogのコメントを参照）。
// 削除成功後の一覧の更新や遷移は、呼び出し元の画面が担う。
export async function deleteRound({
  roundId,
  eventId,
  isMounted,
}: {
  roundId: string;
  eventId: string;
  isMounted: () => boolean;
}): Promise<DeleteRoundResult> {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    if (!isMounted()) return { status: "discarded" };

    if (!user) {
      return { status: "failed", error: "サインインが必要です。" };
    }

    const { error } = await supabase.rpc("disable_round", {
      p_round_event_id: eventId,
      p_round_id: roundId,
    });

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
