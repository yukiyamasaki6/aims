import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwUpdateActivator } from "./sw-update-activator";

const mocks = vi.hoisted(() => ({
  pathname: "/rounds",
  whenPersisted: vi.fn<() => Promise<void>>(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/app/(main)/rounds/_shared/round-op-hub", () => ({
  roundOpHub: { whenPersisted: mocks.whenPersisted },
}));

// ブラウザのService Worker APIは境界のため、登録とwaitingのワーカー、controllerchangeを任意に操作できるスタブで模す。
function fakeWorker() {
  return { postMessage: vi.fn() };
}

function fakeRegistration() {
  return {
    waiting: null as ReturnType<typeof fakeWorker> | null,
    update: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  };
}

let registration = fakeRegistration();
let controllerListeners: Array<() => void> = [];
const assign = vi.fn();

function emitControllerChange() {
  for (const listener of [...controllerListeners]) listener();
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.pathname = "/rounds";
  mocks.whenPersisted.mockReset();
  mocks.whenPersisted.mockResolvedValue(undefined);
  assign.mockReset();
  registration = fakeRegistration();
  controllerListeners = [];
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistration: () => Promise.resolve(registration),
      addEventListener: (_: string, l: () => void) =>
        controllerListeners.push(l),
      removeEventListener: (_: string, l: () => void) => {
        controllerListeners = controllerListeners.filter((x) => x !== l);
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}

async function mount() {
  const view = render(<SwUpdateActivator />);
  await settle();
  return view;
}

async function navigate(view: Awaited<ReturnType<typeof mount>>, to: string) {
  mocks.pathname = to;
  view.rerender(<SwUpdateActivator />);
  await settle();
}

function addLink(href: string, attrs: Record<string, string> = {}) {
  const a = document.createElement("a");
  a.href = href;
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  a.addEventListener("click", (e) => e.preventDefault());
  document.body.append(a);
  return a;
}

describe("SwUpdateActivator", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  describe("リンク操作の前の切り替え", () => {
    it("waitingがあれば遷移を止め、保存の完了後にSKIP_WAITINGを1回送り、controllerchangeの後にlocation.assignする", async () => {
      // Given
      let finish: () => void = () => {};
      mocks.whenPersisted.mockReturnValueOnce(
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
      await vi.advanceTimersByTimeAsync(100);
      expect(waiting.postMessage).not.toHaveBeenCalled();
      finish();
      await settle();
      expect(waiting.postMessage).toHaveBeenCalledTimes(1);
      expect(assign).not.toHaveBeenCalled();
      emitControllerChange();
      await settle();

      // Then
      expect(passed).not.toHaveBeenCalled();
      expect(assign).toHaveBeenCalledWith("http://localhost/rounds/new");
    });

    it("waitingが無ければ止めず、whenPersistedも呼ばない", async () => {
      // Given
      await mount();
      const link = addLink("http://localhost/rounds/new");
      const passed = vi.fn();
      document.addEventListener("click", passed);

      // When
      fireEvent.click(link);
      await settle();

      // Then
      expect(passed).toHaveBeenCalledTimes(1);
      expect(mocks.whenPersisted).not.toHaveBeenCalled();
    });

    it.each([
      ["別のオリジン", "http://example.com/x", {}],
      ["target=_blank", "http://localhost/x", { target: "_blank" }],
      ["download", "http://localhost/x", { download: "" }],
      ["同じパスのハッシュ", "http://localhost/rounds#a", {}],
    ])("%sのリンクは止めない", async (_, href, attrs) => {
      // Given
      registration.waiting = fakeWorker();
      await mount();
      const link = addLink(href, attrs);
      const passed = vi.fn();
      document.addEventListener("click", passed);

      // When
      fireEvent.click(link);
      await settle();

      // Then
      expect(passed).toHaveBeenCalledTimes(1);
      expect(registration.waiting?.postMessage).not.toHaveBeenCalled();
    });

    it("修飾キーつきのclickは止めない", async () => {
      // Given
      registration.waiting = fakeWorker();
      await mount();
      const link = addLink("http://localhost/rounds/new");
      const passed = vi.fn();
      document.addEventListener("click", passed);

      // When
      fireEvent.click(link, { ctrlKey: true });
      await settle();

      // Then
      expect(passed).toHaveBeenCalledTimes(1);
    });

    it("登録の保持の前の操作は止めず、遅れて登録が返っても切り替えも更新もしない", async () => {
      // Given
      let resolveRegistration: (r: unknown) => void = () => {};
      vi.stubGlobal("navigator", {
        serviceWorker: {
          getRegistration: () =>
            new Promise((resolve) => {
              resolveRegistration = resolve;
            }),
          addEventListener: () => {},
          removeEventListener: () => {},
        },
      });
      const waiting = fakeWorker();
      registration.waiting = waiting;
      const view = await mount();
      const link = addLink("http://localhost/rounds/new");
      const passed = vi.fn();
      document.addEventListener("click", passed);

      // When
      fireEvent.click(link);
      resolveRegistration(registration);
      await settle();
      await navigate(view, "/rounds/new");

      // Then
      expect(passed).toHaveBeenCalledTimes(1);
      expect(waiting.postMessage).not.toHaveBeenCalled();
      expect(registration.update).not.toHaveBeenCalled();
    });

    it("controllerchangeが1秒来なければ、押し直して通常の遷移を進め、その遷移では更新しない", async () => {
      // Given
      const waiting = fakeWorker();
      registration.waiting = waiting;
      const view = await mount();
      const link = addLink("http://localhost/rounds/new");
      const passed = vi.fn();
      document.addEventListener("click", passed);

      // When
      fireEvent.click(link);
      await vi.advanceTimersByTimeAsync(1_000);
      registration.waiting = null;
      await navigate(view, "/rounds/new");

      // Then
      expect(waiting.postMessage).toHaveBeenCalledTimes(1);
      expect(passed).toHaveBeenCalledTimes(1);
      expect(assign).not.toHaveBeenCalled();
      expect(registration.update).not.toHaveBeenCalled();
    });

    it("保存が1秒で終わらなければ、合図を送らずに押し直す", async () => {
      // Given
      mocks.whenPersisted.mockReturnValueOnce(new Promise<void>(() => {}));
      const waiting = fakeWorker();
      registration.waiting = waiting;
      await mount();
      const link = addLink("http://localhost/rounds/new");
      const passed = vi.fn();
      document.addEventListener("click", passed);

      // When
      fireEvent.click(link);
      await vi.advanceTimersByTimeAsync(1_000);

      // Then
      expect(waiting.postMessage).not.toHaveBeenCalled();
      expect(passed).toHaveBeenCalledTimes(1);
    });

    it("controllerchangeの後、assignの直前に保存を再確認し、追記された保存の完了を待つ", async () => {
      // Given
      registration.waiting = fakeWorker();
      await mount();
      let finish: () => void = () => {};
      mocks.whenPersisted.mockResolvedValueOnce(undefined).mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      fireEvent.click(addLink("http://localhost/rounds/new"));
      await settle();

      // When
      emitControllerChange();
      await vi.advanceTimersByTimeAsync(100);
      const beforeFinish = assign.mock.calls.length;
      finish();
      await settle();

      // Then
      expect(beforeFinish).toBe(0);
      expect(assign).toHaveBeenCalledTimes(1);
    });

    it("再確認が期限を超えたときはassignせず、押し直して通常の遷移を進める", async () => {
      // Given
      registration.waiting = fakeWorker();
      await mount();
      mocks.whenPersisted
        .mockResolvedValueOnce(undefined)
        .mockReturnValueOnce(new Promise<void>(() => {}));
      const passed = vi.fn();
      document.addEventListener("click", passed);
      fireEvent.click(addLink("http://localhost/rounds/new"));
      await settle();
      emitControllerChange();

      // When
      await vi.advanceTimersByTimeAsync(1_000);

      // Then
      expect(assign).not.toHaveBeenCalled();
      expect(passed).toHaveBeenCalledTimes(1);
    });

    it("保存待ちと有効化待ちは、クリックから1つの1秒を共有する", async () => {
      // Given
      registration.waiting = fakeWorker();
      await mount();
      let finish: () => void = () => {};
      mocks.whenPersisted.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      fireEvent.click(addLink("http://localhost/rounds/new"));
      await vi.advanceTimersByTimeAsync(900);
      finish();
      await settle();

      // When
      await vi.advanceTimersByTimeAsync(99);
      const beforeDeadline = assign.mock.calls.length;
      emitControllerChange();
      await settle();
      const afterChange = assign.mock.calls.length;

      // Then
      expect(beforeDeadline).toBe(0);
      expect(afterChange).toBe(1);
    });

    it("保存待ちを900msで済ませても、1秒を過ぎたcontrollerchangeでは切り替えない", async () => {
      // Given
      const waiting = fakeWorker();
      registration.waiting = waiting;
      await mount();
      let finish: () => void = () => {};
      mocks.whenPersisted.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      fireEvent.click(addLink("http://localhost/rounds/new"));
      await vi.advanceTimersByTimeAsync(900);
      finish();
      await settle();

      // When
      await vi.advanceTimersByTimeAsync(100);
      emitControllerChange();
      await settle();

      // Then
      expect(waiting.postMessage).toHaveBeenCalledTimes(1);
      expect(assign).not.toHaveBeenCalled();
    });

    it("切り替え中の追加のclickは止めたまま、二重に始めない", async () => {
      // Given
      const waiting = fakeWorker();
      registration.waiting = waiting;
      await mount();
      const link = addLink("http://localhost/rounds/new");
      const passed = vi.fn();
      document.addEventListener("click", passed);
      fireEvent.click(link);
      await settle();

      // When
      fireEvent.click(link);
      await settle();

      // Then
      expect(passed).not.toHaveBeenCalled();
      expect(waiting.postMessage).toHaveBeenCalledTimes(1);
    });

    it("諦めた遷移の次の遷移では、再び判定して切り替える", async () => {
      // Given
      const waiting = fakeWorker();
      registration.waiting = waiting;
      const view = await mount();
      fireEvent.click(addLink("http://localhost/rounds/new"));
      await vi.advanceTimersByTimeAsync(1_000);
      await navigate(view, "/rounds/new");
      const passed = vi.fn();
      document.addEventListener("click", passed);

      // When
      fireEvent.click(addLink("http://localhost/rounds/history"));
      await settle();
      emitControllerChange();
      await settle();

      // Then
      expect(waiting.postMessage).toHaveBeenCalledTimes(2);
      expect(passed).not.toHaveBeenCalled();
      expect(assign).toHaveBeenCalledWith("http://localhost/rounds/history");
    });

    it("他の処理が止めたclick(defaultPrevented)は扱わない", async () => {
      // Given
      registration.waiting = fakeWorker();
      await mount();
      const link = addLink("http://localhost/rounds/new");
      const stopper = (e: Event) => e.preventDefault();
      window.addEventListener("click", stopper, true);

      // When
      fireEvent.click(link);
      await settle();
      window.removeEventListener("click", stopper, true);

      // Then
      expect(mocks.whenPersisted).not.toHaveBeenCalled();
    });

    it("待機が無い、保持の前、見送りの押し直しのいずれでもwhenPersistedを呼ばない(押し直し分を除く)", async () => {
      // Given
      const view = await mount();

      // When
      fireEvent.click(addLink("http://localhost/rounds/new"));
      await navigate(view, "/rounds/new");

      // Then
      expect(mocks.whenPersisted).not.toHaveBeenCalled();
    });

    it("アンマウントで中止し、購読を残さない", async () => {
      // Given
      registration.waiting = fakeWorker();
      const view = await mount();
      fireEvent.click(addLink("http://localhost/rounds/new"));
      await settle();

      // When
      view.unmount();
      emitControllerChange();
      await vi.advanceTimersByTimeAsync(2_000);

      // Then
      expect(controllerListeners).toHaveLength(0);
      expect(assign).not.toHaveBeenCalled();
    });
  });

  describe("パスの変化", () => {
    it("waitingが無ければ更新を確認する", async () => {
      // Given
      const view = await mount();

      // When
      await navigate(view, "/rounds/new");

      // Then
      expect(registration.update).toHaveBeenCalledTimes(1);
    });

    it("読み込み時は更新を確認しない", async () => {
      // Given
      // When
      await mount();

      // Then
      expect(registration.update).not.toHaveBeenCalled();
    });

    it("waitingがあるリンク以外の遷移では、合図も更新も再読み込みもしない", async () => {
      // Given
      const waiting = fakeWorker();
      const view = await mount();
      registration.waiting = waiting;

      // When
      await navigate(view, "/rounds/new");

      // Then
      expect(waiting.postMessage).not.toHaveBeenCalled();
      expect(registration.update).not.toHaveBeenCalled();
      expect(mocks.whenPersisted).not.toHaveBeenCalled();
    });

    it("更新の確認が拒否されてもエラーにならない", async () => {
      // Given
      const view = await mount();
      registration.update.mockRejectedValue(new Error("offline"));

      // When
      // Then
      await expect(navigate(view, "/rounds/new")).resolves.toBeUndefined();
    });
  });

  describe("環境", () => {
    it("Service Workerに未対応でもエラーにならない", () => {
      // Given
      vi.stubGlobal("navigator", {});

      // When
      // Then
      expect(() => render(<SwUpdateActivator />)).not.toThrow();
    });

    it("登録が無ければ何もしない", async () => {
      // Given
      vi.stubGlobal("navigator", {
        serviceWorker: { getRegistration: () => Promise.resolve(undefined) },
      });

      // When
      const view = render(<SwUpdateActivator />);
      await settle();

      // Then
      expect(() => view.unmount()).not.toThrow();
    });
  });
});
