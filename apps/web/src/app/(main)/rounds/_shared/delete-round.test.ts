import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteRound } from "./delete-round";

// 列への入り口を境界としてモックし、積まれる操作と、どのラウンドの送信器へ積むかを確かめる。
const log = vi.hoisted(() => ({
  append: vi.fn(),
  round: vi.fn(),
}));
vi.mock("./round-op-log", () => ({ roundOpLog: { round: log.round } }));

beforeEach(() => {
  vi.clearAllMocks();
  log.append.mockResolvedValue(undefined);
  log.round.mockReturnValue({ append: log.append });
});

describe("deleteRound", () => {
  it("そのラウンドの送信器へ、round.disabledを積む", async () => {
    await deleteRound("round-1");

    expect(log.round).toHaveBeenCalledWith("round-1");
    expect(log.append).toHaveBeenCalledWith({
      type: "round.disabled",
      eventId: expect.any(String),
      roundId: "round-1",
    });
  });

  it("削除のたびに新しいeventIdを使う", async () => {
    await deleteRound("round-1");
    await deleteRound("round-1");

    const [first, second] = log.append.mock.calls.map(([op]) => op.eventId);
    expect(first).not.toBe(second);
  });

  it("保存の試みが終わるまで解決しない", async () => {
    let finish: () => void = () => {};
    log.append.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    let resolved = false;
    const promise = deleteRound("round-1").then(() => {
      resolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolved).toBe(false);

    finish();
    await promise;
    expect(resolved).toBe(true);
  });
});
