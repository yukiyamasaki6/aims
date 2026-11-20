import { destinationOf } from "../domain/auth-routes";
import {
  createEmailOtp,
  type EmailOtp,
  type EmailOtpDependencies,
} from "./email-otp";
import type { PageReplace } from "./page-replace";

export type SignIn = EmailOtp;

export function createSignIn({
  pageReplace,
  ...dependencies
}: EmailOtpDependencies & {
  pageReplace: Pick<PageReplace, "replace">;
}): SignIn {
  return createEmailOtp({
    ...dependencies,
    shouldCreateUser: true,
    complete: (from) => pageReplace.replace(destinationOf(from)),
  });
}
