import type { Clock } from "../contract/clock";

export function createBrowserClock(): Clock {
  return {
    now: () => Date.now(),
    // getTimezoneOffsetは西が正のため符号を反転する(0 - xで-0を避ける)。
    utcOffsetMinutes: () => 0 - new Date().getTimezoneOffset(),
    after: (ms, run) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
  };
}
