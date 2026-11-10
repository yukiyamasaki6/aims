import type { SignInFailure } from "./fetch-status";

// データベースへの書き込みの結果。failed: 書き込めなかった(届かなかったときも、サーバーが拒否したときも)。
export type WriteResult = "written" | "failed";

// プリセットの削除と保存の失敗の種類。サインインが必要(SignInFailure)か、書き込めなかった。
// 書き込めなかったときは、届かなかったときも拒否されたときも同じ種類で、サーバーとパッケージの文言は出さない。
export type PresetDeleteFailure = SignInFailure | "deleteFailed";
export type PresetSaveFailure = SignInFailure | "saveFailed";
