"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { usePageRestore } from "@/hooks/use-page-restore";
import type { GoogleSignIn } from "../application/google-sign-in";
import {
  type GoogleSignInEvent,
  type GoogleSignInFlow,
  googleSignInReducer,
  initialGoogleSignInFlow,
} from "../domain/google-sign-in-flow";
import { GoogleButton } from "./google-button";
import { useAuthTexts } from "./use-auth-texts";
import { useScreenView } from "./use-screen-view";

// 「Googleで続ける」と、メールとの区切り「または」(フォームの上に置く)。サインインのメール入力の段階が使う。
// 読み込み後に1回、戻りを手続きへ渡し(`resume`)、bfcacheで戻ったときは実行中を解く。
// readReturn: 押した時点と戻りの時点で読む、戻り先と遷移元(検証していない値で、無ければnull)。
export function GoogleSignInSection({
  googleSignIn,
  readReturn,
}: {
  googleSignIn: GoogleSignIn;
  readReturn: () => { returnPath: string; destination: string | null };
}) {
  const { state, view } = useScreenView<GoogleSignInFlow, GoogleSignInEvent>(
    googleSignInReducer,
    initialGoogleSignInFlow,
  );
  const t = useTranslations("auth");
  const texts = useAuthTexts();
  const errorText = texts.failure(state.error);
  const { dispatch } = view;
  // 画面を開いている間に1回だけ、戻りを処理する。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 読み込み後に1回だけ呼ぶ(戻りはURLから外すため、2回目は何もしない)。
  useEffect(() => {
    void googleSignIn.resume({ destination: readReturn().destination }, view);
  }, []);
  usePageRestore(() => dispatch({ type: "restored" }));

  return (
    <div className="flex w-full flex-col gap-3">
      <GoogleButton
        busy={state.running}
        onClick={() =>
          void googleSignIn.start({ returnPath: readReturn().returnPath }, view)
        }
      >
        {t("googleContinue")}
      </GoogleButton>
      {errorText && (
        <p className="text-center text-destructive text-sm">{errorText}</p>
      )}
      <p className="text-center text-muted-foreground text-sm">
        {t("googleDivider")}
      </p>
    </div>
  );
}
