import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PasswordInput } from "./password-input";

describe("PasswordInput", () => {
  it("is hidden by default", () => {
    render(<PasswordInput placeholder="パスワード" />);
    expect(screen.getByPlaceholderText("パスワード")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("shows the value in plain text after toggling", async () => {
    const user = userEvent.setup();
    render(<PasswordInput placeholder="パスワード" />);

    await user.click(screen.getByRole("button", { name: "パスワードを表示" }));

    expect(screen.getByPlaceholderText("パスワード")).toHaveAttribute(
      "type",
      "text",
    );
  });

  it("hides the value again after toggling twice", async () => {
    const user = userEvent.setup();
    render(<PasswordInput placeholder="パスワード" />);

    const toggle = () =>
      screen.getByRole("button", { name: /パスワードを(表示|非表示)/ });
    await user.click(toggle());
    await user.click(toggle());

    expect(screen.getByPlaceholderText("パスワード")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("forwards value and onChange to the underlying input", async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(
      <PasswordInput
        placeholder="パスワード"
        value=""
        onChange={handleChange}
      />,
    );

    await user.type(screen.getByPlaceholderText("パスワード"), "a");

    expect(handleChange).toHaveBeenCalled();
  });
});
