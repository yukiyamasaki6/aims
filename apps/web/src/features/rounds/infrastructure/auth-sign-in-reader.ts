import { type SessionReader, unconfirmedMessage } from "@/features/auth";
import type { SignInReader } from "../application/fetch-content";

// 認証の入口の読み取りを、取得の約束で包む。未認証のときは、認証の文言を添える。
export function createAuthSignInReader(
  sessionReader: SessionReader,
): SignInReader {
  return {
    async read(options) {
      const reading = await sessionReader.readSession(options);
      if (reading.status === "unauthenticated") {
        return {
          status: "unauthenticated",
          message: unconfirmedMessage(reading.status),
        };
      }
      return reading;
    },
  };
}
