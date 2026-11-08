import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import {
  createUpdateActivation,
  type UpdateActivation,
} from "../application/update-activation";
import { createBrowserLinkClicks } from "../infrastructure/browser-link-clicks";
import { createBrowserServiceWorker } from "../infrastructure/browser-service-worker";
import { SwUpdateActivator } from "./sw-update-activator";

const nav = vi.hoisted(() => ({ pathname: "/rounds" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

function fakeActivation() {
  const pathChanged = vi.fn();
  const start = vi.fn(() => () => {});
  return {
    activation: { start, pathChanged } satisfies UpdateActivation,
    pathChanged,
  };
}

describe("SwUpdateActivator", () => {
  it("何も表示しない", () => {
    // Given
    const { activation } = fakeActivation();

    // When
    const { container } = render(<SwUpdateActivator activation={activation} />);

    // Then
    expect(container).toBeEmptyDOMElement();
  });

  it("表示したときに、経路の通知を1回送る", () => {
    // Given
    nav.pathname = "/rounds";
    const { activation, pathChanged } = fakeActivation();

    // When
    render(<SwUpdateActivator activation={activation} />);

    // Then
    expect(pathChanged).toHaveBeenCalledTimes(1);
  });

  it("経路が変わるたびに通知を送り、変わらない再描画では送らない", () => {
    // Given
    nav.pathname = "/rounds";
    const { activation, pathChanged } = fakeActivation();
    const view = render(<SwUpdateActivator activation={activation} />);

    // When
    view.rerender(<SwUpdateActivator activation={activation} />);
    nav.pathname = "/rounds/new";
    view.rerender(<SwUpdateActivator activation={activation} />);

    // Then
    expect(pathChanged).toHaveBeenCalledTimes(2);
  });

  it("アンマウントの後は、通知を送らない", () => {
    // Given
    nav.pathname = "/rounds";
    const { activation, pathChanged } = fakeActivation();
    const view = render(<SwUpdateActivator activation={activation} />);
    view.unmount();

    // When
    nav.pathname = "/rounds/new";

    // Then
    expect(pathChanged).toHaveBeenCalledTimes(1);
  });
});

// 手続きの単体が通っても壊れる配線(実物のインフラの差し込み、経路の通知、期限の共有)を、旧来の入力と期待値のまま、実物のインフラと偽のブラウザ境界で確かめる。
describe("SwUpdateActivator と実物のインフラの合成", () => {
  const persistence = { whenPersisted: vi.fn<() => Promise<void>>() };
  const assign = vi.fn();
  let registration = fakeRegistration();
  let controllerListeners: Array<() => void> = [];
  let stops: Array<() => void> = [];

  function fakeWorker() {
    return { postMessage: vi.fn() };
  }

  function fakeRegistration() {
    return {
      waiting: null as ReturnType<typeof fakeWorker> | null,
      update: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    };
  }

  function emitControllerChange() {
    for (const listener of [...controllerListeners]) listener();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    nav.pathname = "/rounds";
    persistence.whenPersisted.mockReset();
    persistence.whenPersisted.mockResolvedValue(undefined);
    assign.mockReset();
    registration = fakeRegistration();
    controllerListeners = [];
    stops = [];
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: () => Promise.resolve(registration),
        addEventListener: (_: string, listener: () => void) =>
          controllerListeners.push(listener),
        removeEventListener: (_: string, listener: () => void) => {
          controllerListeners = controllerListeners.filter(
            (x) => x !== listener,
          );
        },
      },
    });
    vi.stubGlobal("location", {
      href: "http://localhost/rounds",
      origin: "http://localhost",
      pathname: "/rounds",
      search: "",
      assign,
    });
  });

  afterEach(() => {
    for (const stop of stops) stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  async function settle() {
    await vi.advanceTimersByTimeAsync(0);
  }

  // ルートの入口と同じ形で、手続きを始め、画面の部品へ渡す。
  async function mount() {
    const activation = createUpdateActivation({
      host: createBrowserServiceWorker(),
      links: createBrowserLinkClicks(),
      persistence,
      clock: createBrowserClock(),
      deadlineMs: 1_000,
    });
    stops.push(activation.start());
    const view = render(<SwUpdateActivator activation={activation} />);
    await settle();
    return {
      navigate: async (to: string) => {
        nav.pathname = to;
        view.rerender(<SwUpdateActivator activation={activation} />);
        await settle();
      },
    };
  }

  function addLink(href: string) {
    const a = document.createElement("a");
    a.href = href;
    a.addEventListener("click", (e) => e.preventDefault());
    document.body.append(a);
    return a;
  }

  it("waitingがあれば遷移を止め、SKIP_WAITINGを1回送り、controllerchangeと保存の再確認の後にlocation.assignする", async () => {
    // Given
    let finish: () => void = () => {};
    persistence.whenPersisted.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const waiting = fakeWorker();
    registration.waiting = waiting;
    await mount();
    const link = addLink("http://localhost/rounds/new");
    const passed = vi.fn();
    document.addEventListener("click", passed);

    // When
    fireEvent.click(link);
    await settle();
    const sentBeforeChange = waiting.postMessage.mock.calls.length;
    emitControllerChange();
    await settle();
    const assignedBeforePersisted = assign.mock.calls.length;
    finish();
    await settle();

    // Then
    expect(sentBeforeChange).toBe(1);
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(assignedBeforePersisted).toBe(0);
    expect(passed).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith("http://localhost/rounds/new");
  });

  it("画面の経路が変わると、waitingが無ければ更新を確認する", async () => {
    // Given
    const { navigate } = await mount();

    // When
    await navigate("/rounds/new");

    // Then
    expect(registration.update).toHaveBeenCalledTimes(1);
  });
});
