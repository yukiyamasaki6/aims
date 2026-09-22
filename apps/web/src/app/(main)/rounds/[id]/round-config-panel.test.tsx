import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type RoundConfig, RoundConfigPanel } from "./round-config-panel";

const initial: RoundConfig = {
  name: "午前練習",
  roundDate: "2026-09-15",
  format: "outdoor",
  bowType: "recurve",
};

function setup(
  overrides: Partial<Parameters<typeof RoundConfigPanel>[0]> = {},
) {
  const onSaved = vi.fn();
  const enqueue = vi.fn();
  const utils = render(
    <RoundConfigPanel
      roundId="round-1"
      initial={initial}
      onSaved={onSaved}
      hasUnmarkedDistances={false}
      enqueue={enqueue}
      {...overrides}
    />,
  );
  return { onSaved, enqueue, ...utils };
}

async function fillValidDraft(user: ReturnType<typeof userEvent.setup>) {
  await user.clear(screen.getByTestId("round-config-name"));
  await user.type(screen.getByTestId("round-config-name"), "午後練習");
}

describe("RoundConfigPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("初期状態では折りたたまれており、保存済みの値を要約表示する", () => {
    setup();

    expect(
      screen.getByText("午前練習 / 2026-09-15 / アウトドア / リカーブ"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("round-config-name")).not.toBeInTheDocument();
  });

  it("要約をクリックすると展開し、再度クリックすると閉じる", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByTestId("round-config-summary"));
    expect(screen.getByTestId("round-config-name")).toBeInTheDocument();

    await user.click(screen.getByTestId("round-config-summary"));
    expect(screen.queryByTestId("round-config-name")).not.toBeInTheDocument();
  });

  it("保存せず閉じて再展開すると、未保存の編集は破棄され保存済みの値に戻る", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByTestId("round-config-summary"));
    await user.clear(screen.getByTestId("round-config-name"));
    await user.type(screen.getByTestId("round-config-name"), "未保存の編集");
    await user.click(screen.getByTestId("round-config-summary"));

    await user.click(screen.getByTestId("round-config-summary"));
    expect(screen.getByTestId("round-config-name")).toHaveValue("午前練習");
  });

  it(`ラウンド名が50文字を超えると保存できずエラーを表示する`, async () => {
    const user = userEvent.setup();
    const { onSaved, enqueue } = setup();

    await user.click(screen.getByTestId("round-config-summary"));
    await user.clear(screen.getByTestId("round-config-name"));
    await user.type(screen.getByTestId("round-config-name"), "あ".repeat(51));
    await user.click(screen.getByTestId("round-config-save"));

    expect(
      screen.getByText("ラウンド名は50文字以内で入力してください。"),
    ).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("実施日が空では保存できずエラーを表示する", async () => {
    const user = userEvent.setup();
    const { onSaved, enqueue } = setup();

    await user.click(screen.getByTestId("round-config-summary"));
    await user.clear(screen.getByTestId("round-config-date"));
    await user.click(screen.getByTestId("round-config-save"));

    expect(screen.getByText("実施日を入力してください。")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("Unmarkedの距離が残っている状態でフィールド以外へ変更しようとするとエラーを表示する", async () => {
    const user = userEvent.setup();
    const { onSaved, enqueue } = setup({ hasUnmarkedDistances: true });

    await user.click(screen.getByTestId("round-config-summary"));
    await user.click(screen.getByTestId("round-config-format-indoor"));
    await user.click(screen.getByTestId("round-config-save"));

    expect(
      screen.getByText(
        "Unmarkedの距離が残っているため、フィールド以外の種別には変更できません。先に各距離をMarkedに変更してください。",
      ),
    ).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("Unmarkedの距離が残っていてもフィールドへの変更は許可される", async () => {
    const user = userEvent.setup();
    const { onSaved, enqueue } = setup({
      hasUnmarkedDistances: true,
      initial: { ...initial, format: "outdoor" },
    });

    await user.click(screen.getByTestId("round-config-summary"));
    await user.click(screen.getByTestId("round-config-format-field"));
    await user.click(screen.getByTestId("round-config-save"));

    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ format: "field" }),
    );
    expect(enqueue).toHaveBeenCalled();
  });

  it("有効な入力で保存すると、onSavedとenqueueが正しい内容で呼ばれ、折りたたまれる", async () => {
    const user = userEvent.setup();
    const { onSaved, enqueue } = setup();

    await user.click(screen.getByTestId("round-config-summary"));
    await fillValidDraft(user);
    await user.click(screen.getByTestId("round-config-bow-type-compound"));
    await user.click(screen.getByTestId("round-config-save"));

    const expectedDraft = {
      name: "午後練習",
      roundDate: "2026-09-15",
      format: "outdoor",
      bowType: "compound",
    };
    expect(onSaved).toHaveBeenCalledWith(expectedDraft);
    expect(enqueue).toHaveBeenCalledWith({
      key: "roundConfig",
      label: "ラウンド設定",
      operation: {
        type: "round.updated",
        eventId: expect.any(String),
        roundId: "round-1",
        ...expectedDraft,
      },
    });
    expect(screen.queryByTestId("round-config-name")).not.toBeInTheDocument();
    expect(
      screen.getByText("午後練習 / 2026-09-15 / アウトドア / コンパウンド"),
    ).toBeInTheDocument();
  });

  it("Escapeキーで閉じると展開状態が解除される（保存はしない）", async () => {
    const user = userEvent.setup();
    const { onSaved, enqueue } = setup();

    await user.click(screen.getByTestId("round-config-summary"));
    expect(screen.getByTestId("round-config-name")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("round-config-name")).not.toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("外部からinitialが更新されると、保存済み・編集中の値も追従する", () => {
    const { rerender } = setup();

    rerender(
      <RoundConfigPanel
        roundId="round-1"
        initial={{ ...initial, name: "更新後" }}
        onSaved={vi.fn()}
        hasUnmarkedDistances={false}
        enqueue={vi.fn()}
      />,
    );

    expect(
      screen.getByText("更新後 / 2026-09-15 / アウトドア / リカーブ"),
    ).toBeInTheDocument();
  });
});
