import { useEffect, useRef } from "react";

// アンマウント後の状態更新や遷移を避けるため、マウント中かどうかを持つref。
export function useMountedRef() {
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return mountedRef;
}
