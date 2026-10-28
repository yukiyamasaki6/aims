import type { ReactNode } from "react";

// 入力欄とそのエラー文。入力欄にはaria属性を渡し、エラー文はエラーIDで結び付ける。
export function AuthField({
  errorId,
  error,
  children,
}: {
  errorId: string;
  error: string | undefined;
  children: (aria: {
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
  }) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      {children({
        "aria-invalid": Boolean(error),
        "aria-describedby": error ? errorId : undefined,
      })}
      {error && (
        <p id={errorId} className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
