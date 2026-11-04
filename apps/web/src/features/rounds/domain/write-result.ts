import type { SignInFailure } from "./fetch-status";

// データベースへの書き込みの結果。unreachable: 届かなかった(応答の状態0か、呼び出しが投げた)。rejected: サーバーが拒否した。
export type WriteResult = "written" | "unreachable" | "rejected";

// プリセットの削除と保存の失敗の種類。サインインを確かめられなかった(SignInFailure)か、書き込めなかった。
// 書き込めなかったときは、届かなかったときも拒否されたときも同じ種類で、サーバーとパッケージの文言は出さない。
export type PresetDeleteFailure = SignInFailure | "deleteFailed";
export type PresetSaveFailure = SignInFailure | "saveFailed";
