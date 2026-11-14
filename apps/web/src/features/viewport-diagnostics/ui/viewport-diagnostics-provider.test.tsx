import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

let viewport: FakeViewport;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  viewport = installFakeViewport();
});

afterEach(() => {
  viewport.restore();
  vi.useRealTimers();
});

function badge() {
  return document.querySelector('[data-testid="viewport-diagnostics-badge"]');
}

function renderProvider(
  setting: ReturnType<typeof createFakeDiagnosticsSetting>,
  children = <p>子要素</p>,
) {
  return render(
    <ViewportDiagnosticsProvider setting={setting}>
      {children}
    </ViewportDiagnosticsProvider>,
    { wrapper: IntlTestProvider },
  );
}

describe("ViewportDiagnosticsProvider", () => {
  it("無効なら、子要素だけを描き、バッジは存在しない", () => {
    // Given
    const setting = createFakeDiagnosticsSetting(false);

    // When
    const { container } = renderProvider(setting);

    // Then
    expect(container.innerHTML).toBe("<p>子要素</p>");
    expect(badge()).toBeNull();
  });

  it("有効なら、子要素とバッジを描く", () => {
    // Given
    const setting = createFakeDiagnosticsSetting(true);

    // When
    renderProvider(setting);

    // Then
    expect(screen.getByText("子要素")).toBeInTheDocument();
    expect(badge()).not.toBeNull();
  });

  it("無効から有効へ切り替えると、バッジが現れる", () => {
    // Given
    const setting = createFakeDiagnosticsSetting(false);
    renderProvider(setting);

    // When
    act(() => setting.write(true));

    // Then
    expect(badge()).not.toBeNull();
  });

  it("有効から無効へ切り替えると、バッジの要素がdocument.bodyから除かれる", () => {
    // Given
    const setting = createFakeDiagnosticsSetting(true);
    renderProvider(setting);

    // When
    act(() => setting.write(false));

    // Then
    expect(badge()).toBeNull();
    expect(screen.getByText("子要素")).toBeInTheDocument();
  });

  it("子の切り替えを押すと、同じタブですぐバッジが現れる", async () => {
    // Given
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderProvider(createFakeDiagnosticsSetting(false), <DiagnosticsToggle />);

    // When
    await user.click(screen.getByRole("switch", { name: text("toggleLabel") }));

    // Then
    expect(badge()).not.toBeNull();
  });

  it("有効のとき子の切り替えをもう一度押すと、バッジが消える", async () => {
    // Given
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderProvider(createFakeDiagnosticsSetting(true), <DiagnosticsToggle />);

    // When
    await user.click(screen.getByRole("switch", { name: text("toggleLabel") }));

    // Then
    expect(badge()).toBeNull();
  });

  it("サーバー側の描画は、設定が有効でもバッジを含めず、子要素を含む(水和の不一致を避ける)", () => {
    // Given
    const setting = createFakeDiagnosticsSetting(true);

    // When
    const html = renderToString(
      <ViewportDiagnosticsProvider setting={setting}>
        <p>子要素</p>
      </ViewportDiagnosticsProvider>,
    );

    // Then
    expect(html).toContain("子要素");
    expect(html).not.toContain("viewport-diagnostics-badge");
  });

  it("無効のあいだ、購読もタイマーも持たない", () => {
    // Given
    const setting = createFakeDiagnosticsSetting(false);

    // When
    renderProvider(setting);

    // Then
    expect(viewport.subscriptions()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("有効にした後に無効へ戻すと、購読もタイマーも0へ戻る", () => {
    // Given
    const setting = createFakeDiagnosticsSetting(false);
    renderProvider(setting);
    act(() => setting.write(true));
    expect(viewport.subscriptions()).toBeGreaterThan(0);

    // When
    act(() => setting.write(false));

    // Then
    expect(viewport.subscriptions()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("有効のままアンマウントすると、購読もタイマーも0になる", () => {
    // Given
    const { unmount } = renderProvider(createFakeDiagnosticsSetting(true));

    // When
    unmount();

    // Then
    expect(viewport.subscriptions()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(badge()).toBeNull();
  });

  it("Providerの外でuseDiagnosticsSettingを使うと、例外にする", () => {
    // Given
    vi.spyOn(console, "error").mockImplementation(() => {});

    // When
    const render_ = () =>
      render(<DiagnosticsToggle />, { wrapper: IntlTestProvider });

    // Then
    expect(render_).toThrow("ViewportDiagnosticsProvider");
  });
});
