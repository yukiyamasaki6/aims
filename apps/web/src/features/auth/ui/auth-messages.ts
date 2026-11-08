import type { AuthFailureKind } from "../domain/auth-failure";
import type { FieldErrorKinds } from "../domain/flow";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../domain/password";

// パスワードの規則の文面。入力が規則に合わないときと、認証サービスが弱いパスワードとして拒否したときに、同じ文面を示す。
const passwordRule = `${PASSWORD_MIN_LENGTH}〜${PASSWORD_MAX_LENGTH}文字の半角英数記号で、英字と数字を含めてください。`;

// authの画面の文言(名前空間: auth)。結果の種類ごとの文言は、種類の値をキーにした入れ子の表に置く。
export const authMessages = {
  ja: {
    // 失敗の種類。認証サービスの文言は出さない。
    failure: {
      offline:
        "ネットワークに接続されていません。接続を確認してから再度お試しください。",
      unreachable:
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      invalid_credentials: "メールアドレスまたはパスワードが間違っています。",
      code_expired: "認証コードが正しくないか、有効期限が切れています。",
      rate_limited:
        "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
      captcha_failed: "認証に失敗しました。もう一度お試しください。",
      weak_password: passwordRule,
      other: "エラーが発生しました。しばらくしてから再度お試しください。",
    } satisfies Record<AuthFailureKind, string>,
    // 入力の誤りの種類。欄ごとに持つ。
    fieldError: {
      email: {
        required: "メールアドレスを入力してください。",
        invalidFormat: "メールアドレスの形式が正しくありません。",
      },
      password: {
        required: "パスワードを入力してください。",
        invalidRule: passwordRule,
      },
      captcha: {
        incomplete: "セキュリティを確認中です。もう一度お試しください。",
      },
      code: {
        required: "認証コードを入力してください。",
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
    passwordPlaceholder: "パスワード",
    passwordShow: "パスワードを表示",
    passwordHide: "パスワードを非表示",
    // サインイン
    signInTitle: "サインイン",
    signInSubmit: "サインイン",
    signInForgotPassword: "パスワードをお忘れですか",
    signInNoAccount: "アカウントをお持ちでない方は",
    signInSignUpLink: "サインアップ",
    // サインアップ
    signUpTitle: "サインアップ",
    signUpFooterLead: "既にアカウントをお持ちの方は",
    signUpFooterLink: "サインイン",
    signUpPasswordTitle: "パスワードを設定",
    signUpPasswordLabel: "パスワード",
    signUpPasswordSubmit: "登録してサインイン",
    // パスワードの再設定
    resetTitle: "パスワードを再設定",
    resetBackToSignIn: "サインインに戻る",
    resetPasswordTitle: "新しいパスワードを設定",
    resetPasswordLabel: "新しいパスワード",
    resetPasswordSubmit: "パスワードを変更",
    // パスワードの設定(サインアップと再設定で共通)
    passwordFieldPlaceholder: "{label}（{min}文字以上・英数字を含む）",
    // 認証コード
    otpSendCode: "認証コードを送信",
    otpTitle: "認証コードを入力",
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
