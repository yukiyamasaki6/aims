import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LeftPanelClient } from "./left-panel-client";

describe("LeftPanelClient", () => {
  it("shows the サインアウト button when signed in", () => {
    render(<LeftPanelClient isSignedIn={true} />);
    expect(
      screen.getByRole("button", { name: "サインアウト" }),
    ).toBeInTheDocument();
  });

  it("hides the サインアウト button when signed out", () => {
    render(<LeftPanelClient isSignedIn={false} />);
    expect(
      screen.queryByRole("button", { name: "サインアウト" }),
    ).not.toBeInTheDocument();
  });

  it("opens the mobile menu overlay when the hamburger button is clicked", async () => {
    const user = userEvent.setup();
    render(<LeftPanelClient isSignedIn={false} />);

    // 閉じるボタン（X）は常時DOM上に存在するため、開いた後に増える
    // オーバーレイの分だけ件数が増えることで開閉を判定する。
    const closeButtonsBefore = screen.getAllByRole("button", {
      name: "メニューを閉じる",
    });
    expect(closeButtonsBefore).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "メニューを開く" }));

    expect(
      screen.getAllByRole("button", { name: "メニューを閉じる" }),
    ).toHaveLength(2);
  });

  it("collapses the desktop panel when the collapse button is clicked", async () => {
    const user = userEvent.setup();
    render(<LeftPanelClient isSignedIn={false} />);

    await user.click(screen.getByRole("button", { name: "パネルを格納する" }));

    expect(
      screen.getByRole("button", { name: "パネルを開く" }),
    ).toBeInTheDocument();
  });
});
