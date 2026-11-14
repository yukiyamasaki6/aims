import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import {
  type FakeViewport,
  installFakeViewport,
} from "@/lib/viewport/fake-viewport-test-helpers";
import { DiagnosticsToggle } from "./diagnostics-toggle";
import { createFakeDiagnosticsSetting } from "./fake-diagnostics-setting-test-helpers";
import { ViewportDiagnosticsProvider } from "./viewport-diagnostics-provider";

const text = translatorFor("viewportDiagnostics");

// 有効にするとProviderが描くバッジが、matchMediaを読むため。
let viewport: FakeViewport;

beforeEach(() => {
  viewport = installFakeViewport();
});

afterEach(() => {
  viewport.restore();
});

function renderToggle(
  setting: ReturnType<typeof createFakeDiagnosticsSetting>,
) {
  return render(
    <ViewportDiagnosticsProvider setting={setting}>
      <DiagnosticsToggle />
    </ViewportDiagnosticsProvider>,
    { wrapper: IntlTestProvider },
  );
}

function toggle() {
  return screen.getByRole("switch", { name: text("toggleLabel") });
}

describe("DiagnosticsToggle", () => {
  it("名前が「表示領域の診断」で、説明文が結ばれたスイッチを表示する", () => {
    // Given
    // When
    renderToggle(createFakeDiagnosticsSetting());

    // Then
    expect(toggle()).toHaveAccessibleDescription(text("toggleDescription"));
  });

  it("設定が無効ならオフ、有効ならオンで表示する", () => {
    // Given
    // When
    const off = renderToggle(createFakeDiagnosticsSetting(false));
    const wasOff = toggle().getAttribute("aria-checked");
    off.unmount();
    renderToggle(createFakeDiagnosticsSetting(true));

    // Then
    expect(wasOff).toBe("false");
    expect(toggle()).toBeChecked();
  });

  it("押すと設定へ有効が書かれ、スイッチがオンになる", async () => {
    // Given
    const user = userEvent.setup();
    const setting = createFakeDiagnosticsSetting(false);
    renderToggle(setting);

    // When
    await user.click(toggle());

    // Then
    expect(setting.read()).toBe(true);
    expect(toggle()).toBeChecked();
  });

  it("オンのときもう一度押すと設定へ無効が書かれ、スイッチがオフになる", async () => {
    // Given
    const user = userEvent.setup();
    const setting = createFakeDiagnosticsSetting(true);
    renderToggle(setting);

    // When
    await user.click(toggle());

    // Then
    expect(setting.read()).toBe(false);
    expect(toggle()).not.toBeChecked();
  });

  it("Tabでフォーカスが届き、Spaceを押すと切り替わる", async () => {
    // Given
    const user = userEvent.setup();
    const setting = createFakeDiagnosticsSetting(false);
    renderToggle(setting);

    // When
    await user.tab();
    const focused = document.activeElement;
    await user.keyboard(" ");

    // Then
    expect(focused).toBe(toggle());
    expect(setting.read()).toBe(true);
  });

  it("設定が外から変わると、表示が追従する", () => {
    // Given
    const setting = createFakeDiagnosticsSetting(false);
    renderToggle(setting);

    // When
    act(() => setting.write(true));

    // Then
    expect(toggle()).toBeChecked();
  });
});
