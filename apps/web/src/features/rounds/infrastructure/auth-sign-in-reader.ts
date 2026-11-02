import { type SessionReader, unconfirmedMessage } from "@/features/auth";
import type { SignInReader } from "../application/sign-in-reader";

// 認証の入口の読み取りを、手続きの約束で包む。未認証と不明のときは、認証の文言を添える。
export function createAuthSignInReader(
  sessionReader: SessionReader,
): SignInReader {
  return {
    async read(options) {
      const reading = await sessionReader.readSession(options);
      if (reading.status === "authenticated") return reading;
      return {
        status: reading.status,
        message: unconfirmedMessage(reading.status),
      };
    },
  };
}
