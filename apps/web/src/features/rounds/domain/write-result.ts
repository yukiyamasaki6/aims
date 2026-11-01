// データベースへの書き込みの結果。unreachable: 届かなかった(応答の状態0か、呼び出しが投げた)。rejected: サーバーが拒否した。
export type WriteResult = "written" | "unreachable" | "rejected";

// プリセットの削除の失敗の文言。届かなかったときも拒否されたときも同じで、サーバーとパッケージの文言は出さない。
export const PRESET_DELETE_ERROR_MESSAGE = "削除できませんでした。";

// プリセットの保存の失敗の文言。届かなかったときも拒否されたときも同じで、サーバーとパッケージの文言は出さない。
export const PRESET_SAVE_ERROR_MESSAGE = "保存できませんでした。";
