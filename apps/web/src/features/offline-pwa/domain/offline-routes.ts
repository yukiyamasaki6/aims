// 枠の配布用のURLの判定と、ナビゲーションに対応する枠の配布用URLの導出。経路の持ち主は経路表(src/routes.ts)である。
import { SHELL_PREFIX, shellUrlOf } from "@/routes";

// 枠の配布用のURLか。
export function isShellUrl(pathname: string): boolean {
  return pathname.startsWith(`${SHELL_PREFIX}/`);
}

// ナビゲーションのpathnameに対応する枠の配布用URL。枠のないパスはnull。
// frameOfは、経路に対応する枠の経路(無ければnull)を返す。枠を決める規則は他の機能が持つため、入口が渡す。
export function frameUrlFor(
  pathname: string,
  frameOf: (pathname: string) => string | null,
): string | null {
  const framePath = frameOf(pathname);
  return framePath === null ? null : shellUrlOf(framePath);
}
