import { useEffect, useRef } from "react";

// 残りの秒数が0になるまで、1秒ごとにonTickを呼ぶ。
// onTickは最新のものを呼ぶため、再描画のたびに作り直されても、1秒の計時はやり直さない。
export function useCountdown(remaining: number, onTick: () => void) {
  const latestTick = useRef(onTick);

  useEffect(() => {
    latestTick.current = onTick;
  });

  useEffect(() => {
    if (remaining === 0) return;
    const timer = setTimeout(() => latestTick.current(), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
}
