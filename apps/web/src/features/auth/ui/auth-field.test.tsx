import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthField } from "./auth-field";

function renderField(error: string | undefined) {
  render(
    <AuthField errorId="email-error" error={error}>
      {(aria) => <input aria-label="メールアドレス" {...aria} />}
    </AuthField>,
  );
  return screen.getByLabelText("メールアドレス");
}

describe("AuthField", () => {
  it("エラーが無ければ、入力欄は不正でなく、エラー文もない", () => {
    // Given

    // When
    const input = renderField(undefined);

    // Then
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("paragraph")).toBeNull();
  });

  it("エラーがあれば、入力欄を不正にしてエラー文のIDで結び、エラー文を表示する", () => {
    // Given

    // When
    const input = renderField("メールアドレスを入力してください。");

    // Then
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "email-error");
    expect(
      screen.getByText("メールアドレスを入力してください。"),
    ).toHaveAttribute("id", "email-error");
  });
});
