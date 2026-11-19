import type { AuthFailureKind } from "../domain/auth-failure";
import type { FieldErrorKinds } from "../domain/flow";
// authの画面の文言(名前空間: auth)。結果の種類ごとの文言は、種類の値をキーにした入れ子の表に置く。
export const authMessages = {
  ja: {
    // 失敗の種類。認証サービスの文言は出さない。
    failure: {
      offline:
        "ネットワークに接続されていません。接続を確認してから再度お試しください。",
      unreachable:
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      code_expired: "認証コードが正しくないか、有効期限が切れています。",
      rate_limited:
        "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
      captcha_failed: "認証に失敗しました。もう一度お試しください。",
      email_exists:
        "このメールアドレスは使えません。別のメールアドレスを入力してください。",
      same_email: "現在と異なるメールアドレスを入力してください。",
      other: "エラーが発生しました。しばらくしてから再度お試しください。",
    } satisfies Record<AuthFailureKind, string>,
    // 入力の誤りの種類。欄ごとに持つ。
    fieldError: {
      email: {
        required: "メールアドレスを入力してください。",
        invalidFormat: "メールアドレスの形式が正しくありません。",
      },
      captcha: {
        incomplete:
          "セキュリティの確認に失敗しました。しばらくしてからもう一度お試しください。",
      },
      code: {
        required: "認証コードを入力してください。",
      },
      currentCode: {
        required: "変更前のメールアドレスの認証コードを入力してください。",
        expiredOrInvalid: "認証コードが正しくないか、有効期限が切れています。",
      },
      newCode: {
        required: "変更後のメールアドレスの認証コードを入力してください。",
        expiredOrInvalid: "認証コードが正しくないか、有効期限が切れています。",
      },
      resend: {
        cooldown:
          "再送はクールダウン中です。しばらくしてから再度お試しください。",
      },
    } satisfies {
      [Field in keyof FieldErrorKinds]: Record<FieldErrorKinds[Field], string>;
    },
    // 共通
    back: "戻る",
    emailPlaceholder: "you@example.com",
    // サインイン
    emailContinue: "メールで続ける",
    // メールアドレスの変更
    changeEmailTitle: "メールアドレス変更",
    changeEmailCurrent: "現在のメールアドレス: {email}",
    changeEmailNewPlaceholder: "新しいメールアドレス",
    changeEmailCodeDescription:
      "それぞれのメールアドレスに送信されたコードを入力してください。",
    changeEmailCurrentCodeLabel: "変更前（{email}）",
    changeEmailNewCodeLabel: "変更後（{email}）",
    changeEmailDone: "メールアドレスを変更しました",
    // アカウントの削除
    deleteAccountTitle: "アカウント削除",
    deleteAccountIrreversible: "アカウントを削除すると元に戻せません。",
    deleteAccountItemRelated:
      "アカウントに関連するラウンド・プリセットが削除されます",
    deleteAccountItemOthersRemain:
      "ラウンドに他の編集可能な利用者がいる場合は削除されません",
    deleteAccountItemDuration: "削除には時間がかかる場合があります",
    deleteAccountPrompt:
      "内容を確認して、削除する場合はボタンを押してください。",
    deleteAccountVerify: "確認して削除",
    deleteAccountSubmit: "アカウントを削除",
    // 認証コード
    otpSendCode: "認証コードを送信",
    otpDescription: "{email} に送信されたコードを入力してください。",
    otpSpamNote: "メールが届かない場合は、迷惑メールフォルダをご確認ください。",
    otpCodePlaceholder: "123456",
    otpVerify: "確認",
    otpResend: "再送",
    otpResendWait: "再送（{seconds}秒）",
    // サインアウト
    signOut: "サインアウト",
    signOutConfirm: "サインアウトしますか？",
    signOutConfirmLabel: "サインアウトする",
  },
} as const;
