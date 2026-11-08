// 枠の配布用のURLの判定。経路の持ち主は経路表(src/routes.ts)である。
import { SHELL_PREFIX } from "@/routes";

// 枠の配布用のURLか。
export function isShellUrl(pathname: string): boolean {
  return pathname.startsWith(`${SHELL_PREFIX}/`);
}
