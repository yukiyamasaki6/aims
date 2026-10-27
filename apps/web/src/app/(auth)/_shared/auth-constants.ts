// signup/reset-passwordの認証フォームで共通の入力制約。

// Supabase Authはbcryptでパスワードをハッシュしており、72バイトを超えた
// 部分は無視される。パスワードは半角英数記号のみ（PASSWORD_ALLOWED_PATTERN）
// に制限しているため、文字数=バイト数として扱える。
export const PASSWORD_MAX_LENGTH = 72;

// 半角英数記号（印字可能なASCII、空白を除く）のみを許可する。
export const PASSWORD_ALLOWED_PATTERN = /^[!-~]*$/;

// Supabase Authが発行するOTP認証コードの桁数（固定）。
export const OTP_CODE_LENGTH = 6;
