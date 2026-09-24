import { OTP_CODE_LENGTH } from "./auth-constants";

// OTP認証コード（固定桁数の数字）の形式。
export const CODE_PATTERN = new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`);
