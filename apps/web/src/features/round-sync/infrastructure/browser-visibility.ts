import type { Visibility } from "../application/sync-triggers";

export function createBrowserVisibility(): Visibility {
  return {
    onVisible(listener) {
      const handle = () => {
        if (document.visibilityState === "visible") listener();
      };
      document.addEventListener("visibilitychange", handle);
      return () => document.removeEventListener("visibilitychange", handle);
    },
  };
}
