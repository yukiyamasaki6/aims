import type { Clock } from "../contract/clock";

export function createBrowserClock(): Clock {
  return {
    now: () => Date.now(),
    after: (ms, run) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
  };
}
