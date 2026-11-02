// 同時に1回までの実行の制御。実行中の契機は、完了後に1回だけやり直す。
export type FlightGate = {
  readonly running: boolean;
  readonly again: boolean;
};

export const IDLE_GATE: FlightGate = { running: false, again: false };

// 契機が届いた。runが真なら、呼び出し側が実行を始める。
export function beginFlight(gate: FlightGate): {
  gate: FlightGate;
  run: boolean;
} {
  if (gate.running) return { gate: { running: true, again: true }, run: false };
  return { gate: { running: true, again: false }, run: true };
}

// 実行が終わった。againが真なら、呼び出し側がもう1度実行する(実行中でありつづける)。
export function endFlight(gate: FlightGate): {
  gate: FlightGate;
  again: boolean;
} {
  if (gate.again) return { gate: { running: true, again: false }, again: true };
  return { gate: IDLE_GATE, again: false };
}
