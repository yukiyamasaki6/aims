const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TIME = 0xffff_ffff_ffff;

function hex(value: number, length: number): string {
  return value.toString(16).padStart(length, "0");
}

// 新しい矢のIDを、そのエンドの既にある矢のIDより大きい時刻順のUUIDにする。同点はIDの昇順に並ぶため、足した矢は同点の後ろに入る。
// UUIDv7の形式で、先頭48ビットは端末の時計と、既にある矢の先頭48ビットの最大+1の大きい方。randomは10バイト以上。
export function shotIdAfter(
  endShotIds: readonly string[],
  nowMs: number,
  random: Uint8Array,
): string {
  const known = endShotIds
    .filter((id) => UUID.test(id))
    .map((id) => Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16));
  const after = known.length > 0 ? Math.max(...known) + 1 : 0;
  // 既にある矢の先頭が最大値のときは時計の値にする(その矢より前に入る)。
  const time = after > MAX_TIME ? nowMs : Math.max(nowMs, after);
  const timeHex = hex(time, 12);
  const versionHex = hex(0x7000 | ((random[0] & 0x0f) << 8) | random[1], 4);
  const variantHex = hex(0x8000 | ((random[2] & 0x3f) << 8) | random[3], 4);
  const restHex = Array.from(random.subarray(4, 10), (b) => hex(b, 2)).join("");
  return `${timeHex.slice(0, 8)}-${timeHex.slice(8)}-${versionHex}-${variantHex}-${restHex}`;
}

export function newShotId(endShotIds: readonly string[]): string {
  return shotIdAfter(
    endShotIds,
    Date.now(),
    crypto.getRandomValues(new Uint8Array(10)),
  );
}
