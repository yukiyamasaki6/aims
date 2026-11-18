"use client";

import {
  Turnstile as ReactTurnstile,
  type TurnstileInstance,
} from "@marsidev/react-turnstile";
import {
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { CHECK_WAIT_LIMIT_MS } from "../domain/captcha-token";

// 画面が持つ取り直しの参照の型。画面が使うのは取り直し(reset)だけで、畳みはこの呼び出しに連動する。
export type TurnstileReset = Pick<TurnstileInstance, "reset">;

export function Turnstile({
  siteKey,
  onVerify,
  onFailed,
  waiting,
  ref,
}: {
  // サイトキー(環境変数の値)。読み出しは画面の入口が行い、引数で渡す。空のときはウィジェットがエラーを報告し、チェック未完了のまま送信は止まる。
  siteKey: string;
  onVerify: (token: string | null) => void;
  // チェックの失敗(エラー、未対応、待ちの上限)。トークンの到着では呼ばない。待ちの判断は呼び出し側が持つ。
  onFailed?: () => void;
  // 操作がトークンを待っている(待ち中で、トークンが無い)。追加チェックを表示していない間だけ、上限を数え、上限で`onFailed`を呼ぶ。
  waiting: boolean;
  ref?: Ref<TurnstileReset | undefined>;
}) {
  // 枠の状態。展開中は、追加チェックの表示(before-interactive)と部品の失敗(error、unsupported)で入り、画面から受けた参照を通したresetだけで畳む。
  const [expanded, setExpanded] = useState(false);
  // 追加チェックの表示中(before-interactiveからafter-interactiveまで)。待ちの上限の停止だけに使い、枠の展開とは別に持つ。
  const [interactive, setInteractive] = useState(false);
  const widget = useCollapsingHandle(ref, () => {
    setExpanded(false);
    setInteractive(false);
  });
  const latestOnFailed = useRef(onFailed);
  useEffect(() => {
    latestOnFailed.current = onFailed;
  });
  useEffect(() => {
    if (!waiting || interactive) return;
    const timer = setTimeout(
      () => latestOnFailed.current?.(),
      CHECK_WAIT_LIMIT_MS,
    );
    return () => clearTimeout(timer);
  }, [waiting, interactive]);

  return (
    <>
      {/*
        appearance: "interaction-only"で、操作が必要なときだけウィジェットが現れる。
        通常は画面の領域を取らないようsr-only（1pxのabsolute）に畳む。
        チャレンジの実行に影響し得るため、hiddenやdisplay:noneにはしない。
        操作が必要なときは、Cloudflareの公式仕様（normalサイズ = 300x65px）の領域で表示する。
      */}
      <div
        className={
          expanded ? "h-[65px] w-[300px] self-center rounded-lg" : "sr-only"
        }
      >
        <ReactTurnstile
          ref={widget}
          siteKey={siteKey}
          onBeforeInteractive={() => {
            setExpanded(true);
            setInteractive(true);
          }}
          onAfterInteractive={() => setInteractive(false)}
          onSuccess={(token) => {
            setInteractive(false);
            onVerify(token);
          }}
          onExpire={() => onVerify(null)}
          onError={() => {
            setExpanded(true);
            onVerify(null);
            onFailed?.();
          }}
          onUnsupported={() => {
            setExpanded(true);
            onFailed?.();
          }}
          options={{ size: "normal", appearance: "interaction-only" }}
        />
      </div>
    </>
  );
}

// 画面へ渡す参照を作る。resetだけを持ち、ライブラリのresetを包んで、取り直しの指示で`onReset`(枠を畳み、追加チェックの表示中を解く)を呼ぶ。ライブラリ自身の取り直し(refresh-expired)は包まないため、畳まない。
function useCollapsingHandle(
  ref: Ref<TurnstileReset | undefined> | undefined,
  onReset: () => void,
) {
  const widget = useRef<TurnstileInstance | undefined>(undefined);
  useImperativeHandle(ref, () => ({
    reset: () => {
      widget.current?.reset();
      onReset();
    },
  }));
  return widget;
}
