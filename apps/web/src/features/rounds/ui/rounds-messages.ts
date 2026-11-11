import type { DistanceConfigError } from "../domain/distance-config";
import type { FetchFailure, SignInFailure } from "../domain/fetch-status";
import type { RoundConfigError } from "../domain/round-config";
import type { BowTypeOption, FormatOption } from "../domain/round-constants";
import { NAME_MAX_LENGTH } from "../domain/round-constants";
import type { PresetDeleteFailure } from "../domain/write-result";
import type { PresetDialogError } from "./save-preset-dialog-state";

// サインインが必要なときの文言。取得、開始、プリセットの保存と削除が共有する。
const signInFailureText = {
  unauthenticated: "サインインが必要です。",
} as const satisfies Record<SignInFailure, string>;

// roundsの画面の文言(名前空間: rounds)。結果の種類ごとの文言は、種類の値をキーにした入れ子の表に置く。
export const roundsMessages = {
  ja: {
    // 共通
    save: "保存",
    delete: "削除",
    back: "戻る",
    requiredMark: "*",
    // 取得の状態
    fetchLoading: "読み込み中",
    fetchOffline: "ネットワークに接続されていません",
    fetchRetry: "再試行",
    fetchFailure: {
      unauthenticated: signInFailureText.unauthenticated,
      failed: "読み込めませんでした。",
    } satisfies Record<FetchFailure, string>,
    // ホームと履歴
    homeEmpty: "入力中のラウンドはありません",
    historyEmpty: "完了したラウンドはありません。",
    newRoundLabel: "ラウンドを新規作成",
    roundTotalPoints: "{total}点",
    roundMenuLabel: "ラウンドのメニュー",
    roundMenuLabelNamed: "「{name}」のメニュー",
    roundDelete: "ラウンドを削除",
    roundDeleteConfirm:
      "このラウンドを削除しますか？記録したスコアもすべて失われます。",
    roundDeleteConfirmNamed:
      "「{name}」を削除しますか？記録したスコアもすべて失われます。",
    detailNotFound: "ラウンドが見つかりません。",
    // ラウンドの作成とプリセット
    startNotice: "種別・弓種・距離は開始後に変更可能です。",
    startWithPreset: "「{name}」で開始",
    startWithoutPreset: "プリセット無しで開始",
    roundStartUnauthenticated: signInFailureText.unauthenticated,
    presetPersonal: "個人プリセット",
    presetPersonalEmpty: "プリセットとして保存すると、ここに表示されます。",
    presetGlobal: "公式プリセット",
    presetMenuLabel: "「{name}」のメニュー",
    presetDeleteConfirm: "「{name}」を削除しますか？",
    presetDeleteFailure: {
      ...signInFailureText,
      deleteFailed: "削除できませんでした。",
    } satisfies Record<PresetDeleteFailure, string>,
    presetSaveTrigger: "プリセット保存",
    presetSaveTitle: "現在の構成をプリセットとして保存しますか？",
    presetName: "プリセット名",
    presetSaveFailure: {
      ...signInFailureText,
      saveFailed: "保存できませんでした。",
      noDistances: "距離がないため、プリセットとして保存できません。",
      nameTooLong: `プリセット名は${NAME_MAX_LENGTH}文字以内で入力してください。`,
    } satisfies Record<PresetDialogError, string>,
    // 種別と弓種
    formatOption: {
      outdoor: "アウトドア",
      indoor: "インドア",
      field: "フィールド",
    } satisfies Record<FormatOption, string>,
    bowTypeOption: {
      recurve: "リカーブ",
      compound: "コンパウンド",
      barebow: "ベアボウ",
    } satisfies Record<BowTypeOption, string>,
    formatBowType: "{format} / {bowType}",
    // ラウンドの設定
    roundConfigName: "ラウンド名",
    roundConfigDate: "実施日",
    roundConfigFormat: "種別",
    roundConfigBowType: "弓種",
    roundConfigError: {
      tooLong: `ラウンド名は${NAME_MAX_LENGTH}文字以内で入力してください。`,
      required: "実施日を入力してください。",
      unmarkedDistances:
        "Unmarkedの距離が残っているため、フィールド以外の種別には変更できません。先に各距離をMarkedに変更してください。",
    } satisfies Record<RoundConfigError, string>,
    // 距離
    addDistance: "距離を追加",
    distanceDelete: "距離を削除",
    distanceDeleteConfirm:
      "この距離にはすでにスコアが記録されています。削除するとスコアも失われます。削除しますか？",
    distanceLocked: "スコアが記録済みのため変更できません",
    distanceFieldDistance: "距離（m）",
    distanceFieldArrows: "エンドあたりの本数",
    distanceFieldTotalEnds: "総エンド数",
    distanceTargetFace: "的",
    distanceMarkedToggle: "Marked / Unmarked",
    distanceMarked: "Marked",
    distanceUnmarked: "Unmarked",
    distanceEnds: "{arrowsPerEnd}本×{totalEnds}エンド",
    distanceConfigError: {
      required: "距離を入力してください。",
      notPositiveInteger: "1以上の整数を入力してください。",
      tooLarge: "{max}以下の整数を入力してください。",
      shotsUnfit:
        "記録済みのスコアが失われるため、変更できません。先にスコアを削除してください。",
    } satisfies Record<DistanceConfigError, string>,
    // 的
    targetFaceName: "的",
    targetFaceMissing: "的データを取得できません",
    targetFaceSize: "{size}cm",
    targetFaceTrigger: "{name}（タップで変更）",
    targetFaceTriggerLocked: "{name}（スコア記録済みのため変更不可）",
    targetFaceTriggerMissing: "的データを取得できません（タップで変更）",
    filterAll: "すべて",
    // スコア入力
    keypadClose: "テンキーを閉じる",
    keypadPanelClose: "テンキーパネルを閉じる",
    keypadUndo: "一つ戻る",
    keypadRedo: "一つ進む",
    keypadClear: "クリア",
    keypadClearKey: "C",
    endBlankAdd: "エンド{end}に追加",
    topScores: "{firstLabel}: {firstCount} / {secondLabel}: {secondCount}",
    roundTotal: "合計{total}",
    distanceSubtotal: "小計{total}",
    // 入力の完了
    completeRound: "入力を完了する",
    completeRoundConfirm: "完了する",
    completionConfirmation: {
      noRecords: "記録がありません。入力を完了しますか？",
      unfilledCells: "未入力のマスがあります。入力を完了しますか？",
    },
  },
} as const;
