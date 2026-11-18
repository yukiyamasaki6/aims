import { useEffect, useRef } from "react";
import { type CheckWaiting, isCaptchaCompleted } from "../domain/captcha-token";

// セキュリティチェックを待つ送信を、トークンの到着で再開するフック(UIの副作用)。
// 待ちの状態と判定は集約が持ち、待ちの上限(追加チェックの表示中を除く)は、チェックの部品が数える。
// - run: 押した時点の入力を記憶して、resumeを呼ぶ。記憶は、待ちの間の再押下では更新しない。
// - トークンが届いた待ちは、記憶した入力で、最新の描画のresumeを1回呼ぶ(resumeは同じ操作の開始を再び呼ぶ)。
// - checkProps: チェックの部品の`waiting`(トークンを待っている)と`onFailed`(失敗と上限。集約へcheckWaitReleasedとして送る)へ渡す。
// - 離脱では、再開も送信もしない。
export function useCheckWait<Input>({
  flow: { awaitingCheck, captchaToken },
  dispatch,
  resume,
}: {
  flow: Pick<CheckWaiting, "awaitingCheck" | "captchaToken">;
  dispatch: (event: { type: "checkWaitReleased" }) => void;
  resume: (input: Input) => void;
}): {
  run: (input: Input) => void;
  checkProps: { waiting: boolean; onFailed: () => void };
} {
  const remembered = useRef<{ input: Input } | null>(null);
  const latestResume = useRef(resume);
  useEffect(() => {
    latestResume.current = resume;
  });
  const completed = isCaptchaCompleted(captchaToken);

  useEffect(() => {
    if (!awaitingCheck || !completed) return;
    const entry = remembered.current;
    remembered.current = null;
    if (entry) latestResume.current(entry.input);
  }, [awaitingCheck, completed]);

  return {
    run(input) {
      if (!awaitingCheck) remembered.current = { input };
      resume(input);
    },
    checkProps: {
      waiting: awaitingCheck && !completed,
      onFailed: () => dispatch({ type: "checkWaitReleased" }),
    },
  };
}
