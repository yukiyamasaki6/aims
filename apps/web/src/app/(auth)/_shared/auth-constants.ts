// signin/signup/reset-passwordの3つの認証フォームで共通の入力制約とエラーメッセージ。

// RFC 5321のアドレス全体の最大長（オクテット）。メールアドレスは実務上
// ほぼASCIIのため、文字数をそのままバイト数とみなして問題ない。
export const EMAIL_MAX_LENGTH = 254;

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Supabase Authはbcryptでパスワードをハッシュしており、72バイトを超えた
// 部分は無視される。パスワードは半角英数記号のみ（PASSWORD_ALLOWED_PATTERN）
// に制限しているため、文字数=バイト数として扱える。
export const PASSWORD_MAX_LENGTH = 72;

// 半角英数記号（印字可能なASCII、空白を除く）のみを許可する。
export const PASSWORD_ALLOWED_PATTERN = /^[!-~]*$/;

// Supabase Authが発行するOTP認証コードの桁数（固定）。
export const OTP_CODE_LENGTH = 6;

export const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";
