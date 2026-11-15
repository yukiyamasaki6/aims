// ブラウザの表示領域に関する状態(matchMedia、visualViewport、navigator.virtualKeyboard、innerHeight)と、購読の数を、テストが動かせる偽物。
// jsdomにはmatchMediaとvisualViewportが無い。

const WATCHED_EVENTS = ["resize"];
const WIDE_QUERY = "(min-width: 768px)";

export type FakeViewportOptions = {
  // display-mode: standaloneに一致するか。
  standalone: boolean;
  // 幅768px以上(min-width: 768px)に一致するか。
  wide: boolean;
  // navigator.virtualKeyboardを持つか。
  virtualKeyboard: boolean;
  // nullならvisualViewportを持たない。
  visualViewport: { height: number; scale: number } | null;
  innerHeight: number;
};

export type FakeViewport = {
  // visualViewportの高さを、通知なしに替える。
  setVisualViewportHeight(height: number): void;
  setInnerHeight(height: number): void;
  // 幅768px以上かを替え、matchMediaのchangeの購読者へ通知する(actで包むのは呼ぶ側)。
  setWide(wide: boolean): void;
  // visualViewportのresizeを発火する。
  fireVisualViewportResize(): void;
  // 解除されていない購読(resize)の数。
  subscriptions(): number;
  restore(): void;
};

const DEFAULTS: FakeViewportOptions = {
  standalone: false,
  wide: false,
  virtualKeyboard: false,
  visualViewport: null,
  innerHeight: 800,
};

type Registration = {
  target: EventTarget;
  type: string;
  listener: EventListenerOrEventListenerObject;
};

function saveProperty(target: object, name: string) {
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  return () => {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else Reflect.deleteProperty(target, name);
  };
}

function defineValue(target: object, name: string, value: unknown) {
  Object.defineProperty(target, name, {
    value,
    configurable: true,
    writable: true,
  });
}

export function installFakeViewport(
  overrides: Partial<FakeViewportOptions> = {},
): FakeViewport {
  const options = { ...DEFAULTS, ...overrides };
  const restores = [
    saveProperty(window, "matchMedia"),
    saveProperty(window, "visualViewport"),
    saveProperty(window, "innerHeight"),
    saveProperty(navigator, "virtualKeyboard"),
  ];
  const registrations: Registration[] = [];

  function watch(target: EventTarget) {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    target.addEventListener = (type, listener, ...rest) => {
      if (listener && WATCHED_EVENTS.includes(type)) {
        registrations.push({ target, type, listener });
      }
      return add(type, listener, ...rest);
    };
    target.removeEventListener = (type, listener, ...rest) => {
      const index = registrations.findIndex(
        (r) =>
          r.target === target && r.type === type && r.listener === listener,
      );
      if (index >= 0) registrations.splice(index, 1);
      return remove(type, listener, ...rest);
    };
    return () => {
      target.addEventListener = add;
      target.removeEventListener = remove;
    };
  }

  const unwatch = [watch(window), watch(document)];

  let wide = options.wide;
  const wideListeners = new Set<() => void>();
  defineValue(window, "matchMedia", (query: string) => {
    const isWide = query === WIDE_QUERY;
    return {
      get matches() {
        return isWide
          ? wide
          : options.standalone && query === "(display-mode: standalone)";
      },
      media: query,
      addEventListener(type: string, listener: () => void) {
        if (isWide && type === "change") wideListeners.add(listener);
      },
      removeEventListener(type: string, listener: () => void) {
        if (isWide && type === "change") wideListeners.delete(listener);
      },
    };
  });
  defineValue(window, "innerHeight", options.innerHeight);
  if (options.virtualKeyboard) defineValue(navigator, "virtualKeyboard", {});
  else Reflect.deleteProperty(navigator, "virtualKeyboard");

  const viewport = options.visualViewport
    ? Object.assign(new EventTarget(), options.visualViewport)
    : null;
  if (viewport) unwatch.push(watch(viewport));
  defineValue(window, "visualViewport", viewport ?? undefined);
  if (!viewport) Reflect.deleteProperty(window, "visualViewport");

  return {
    setVisualViewportHeight(height) {
      if (viewport) viewport.height = height;
    },
    setInnerHeight(height) {
      defineValue(window, "innerHeight", height);
    },
    setWide(next) {
      wide = next;
      for (const listener of [...wideListeners]) listener();
    },
    fireVisualViewportResize() {
      viewport?.dispatchEvent(new Event("resize"));
    },
    subscriptions: () => registrations.length,
    restore() {
      wideListeners.clear();
      for (const undo of unwatch) undo();
      for (const restoreProperty of restores) restoreProperty();
      document.documentElement.style.removeProperty("--app-height");
    },
  };
}
