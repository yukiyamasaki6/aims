import { destinationOf } from "../domain/auth-routes";
import {
  createEmailOtp,
  type EmailOtp,
  type EmailOtpDependencies,
} from "./email-otp";
import type { PageReplace } from "./page-replace";

export type SignUp = EmailOtp;

export function createSignUp({
  pageReplace,
  ...dependencies
}: EmailOtpDependencies & {
  pageReplace: Pick<PageReplace, "replace">;
}): SignUp {
  return createEmailOtp({
    ...dependencies,
    shouldCreateUser: true,
    complete: () => pageReplace.replace(destinationOf(null)),
  });
}
