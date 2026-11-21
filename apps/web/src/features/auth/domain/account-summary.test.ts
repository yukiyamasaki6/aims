import { describe, expect, it } from "vitest";
import { googleIdentityOf, type IdentityRecord } from "./account-summary";

const email: IdentityRecord = {
  id: "identity-email",
  provider: "email",
  email: "archer@example.test",
  createdAt: "2026-01-01T00:00:00Z",
};
const google: IdentityRecord = {
  id: "identity-google",
  provider: "google",
  email: "archer@gmail.example.test",
  createdAt: "2026-02-01T00:00:00Z",
};
const olderGoogle: IdentityRecord = {
  ...google,
  id: "identity-google-old",
  createdAt: "2026-01-15T00:00:00Z",
};

describe("googleIdentityOf", () => {
  it("行に示すGoogleの手段を、identitiesから選ぶ", () => {
    // Given
    // When
    const results = [
      [email],
      [google],
      [google, olderGoogle],
      [email, { ...email, provider: "github" }],
      [],
    ].map((identities) => googleIdentityOf(identities));

    // Then
    expect(results).toEqual([
      null,
      { id: "identity-google", email: "archer@gmail.example.test" },
      { id: "identity-google-old", email: "archer@gmail.example.test" },
      null,
      null,
    ]);
  });

  it("作成の時刻が読めないGoogleの手段は、時刻のある手段より後ろにする", () => {
    // Given
    const unknownTime = { ...olderGoogle, createdAt: null };

    // When
    const result = googleIdentityOf([unknownTime, google]);

    // Then
    expect(result?.id).toBe("identity-google");
  });
});
