import { useEffect, useRef } from "react";

// アンマウント後の状態更新や遷移を避けるため、マウント中かどうかを持つref。
export function useMountedRef() {
  const mountedRef = useRef(true);

  useEffect(() => {
    // Strict Modeの開発時二重実行（マウント→クリーンアップ→再マウント）に
    // 対応するため、マウント時にも明示的にtrueへ戻す。
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return mountedRef;
}
