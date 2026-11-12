import { vi } from "vitest";

type Callback = (
  entries: Pick<IntersectionObserverEntry, "isIntersecting">[],
) => void;

// 作られた観測の1つ。観測の対象と、作ったときの設定を持つ。
export type FakeObserverRecord = {
  readonly callback: Callback;
  readonly init: IntersectionObserverInit | undefined;
  readonly targets: Set<Element>;
};

// jsdomには交差の判定が無いため、テストが交差を起こす偽物に差し替える。交差の通知を起こす入口だけを持つ。
export function installFakeIntersectionObserver() {
  const live = new Set<FakeObserverRecord>();
  let near = false;

  class FakeIntersectionObserver {
    private readonly record: FakeObserverRecord;
    constructor(callback: Callback, init?: IntersectionObserverInit) {
      this.record = { callback, init, targets: new Set() };
      live.add(this.record);
    }
    observe(target: Element) {
      this.record.targets.add(target);
      if (near) this.record.callback([{ isIntersecting: true }]);
    }
    disconnect() {
      live.delete(this.record);
    }
  }
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

  return {
    // 生きている観測の全てに、対象が交差したと通知する。呼び手は`act`で包む。
    intersect() {
      for (const record of [...live]) {
        record.callback([{ isIntersecting: true }]);
      }
    },
    // 以降に作られる観測は、観測を始めた時点で交差していると通知する(監視を作り直した最初の通知)。
    setNear(next: boolean) {
      near = next;
    },
    // 生きている観測。
    observers: () => [...live],
  };
}
