import type { SessionReader } from "@/features/auth";
import type { SessionCheck } from "../application/session-check";

// 認証の入口の読み取りを、同期の約束で包む。
export function createAuthSessionCheck(
  sessionReader: SessionReader,
): SessionCheck {
  return {
    async read() {
      try {
        return await sessionReader.readSession();
      } catch {
        return { status: "unknown" };
      }
    },
  };
}
