import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { AppLogo } from "./app-logo";

describe("AppLogo", () => {
  // 遷移先は、押して確かめるE2E(navigation.spec.ts)に任せる。
  it("AIMSのリンクを表示する", () => {
    // Given
    // When
    render(<AppLogo />, { wrapper: IntlTestProvider });

    // Then
    expect(screen.getByRole("link", { name: "AIMS" })).toBeInTheDocument();
  });
});
