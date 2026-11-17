"use client";

import { useTranslations } from "next-intl";
import { type RefObject, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  buildRoundUpdatedOperation,
  type RoundConfig,
} from "../domain/round-config";
import { NAME_MAX_LENGTH } from "../domain/round-constants";
import type { SyncOperation } from "../domain/sync-events";
import { useRoundProcedures } from "./rounds-context";

// 名前の表示のボタンと入力欄が共有する箱(文字の大きさ14px、左右の余白、枠線の幅)。表示と入力で幅が飛ばない。
const NAME_BOX = "h-8 items-center border border-transparent px-2.5 text-sm";

// 編集中の入力欄。入力は50文字までで、確定でのエラーは持たない。Enter(変換中を除く)で確定し、Escで取り消す(どちらも、表示に戻った後に名前のボタンへフォーカスを移す)。入力欄の外の操作(blur)での確定は、移した先のフォーカスを残す。
function NameInput({
  value,
  onChange,
  onFinish,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onFinish: (commit: boolean, refocus: boolean) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const t = useTranslations("rounds");
  const placeholder = t("roundNamePlaceholder");
  return (
    // 見えない同じ文字(sizer)と入力欄を同じマスに重ね、入力欄の幅を文字に合わせて増減させる(上限は親の幅)。末尾にカーソルの幅(2px)だけを足し、文字の左右の余白を同じにする。入力欄の幅は0にして最小幅を親(マス)の幅にし、入力欄自身の固有の幅(約20文字分)が列の幅に効かないようにする。変換中の未確定文字も、入力欄の値に含まれるので測れる。空のときはプレースホルダーの幅。
    <span className="inline-grid max-w-full min-w-0 grid-cols-[minmax(0,auto)]">
      <span
        aria-hidden="true"
        className={`invisible col-start-1 row-start-1 overflow-hidden whitespace-pre ${NAME_BOX}`}
      >
        {value || placeholder}
        <span className="inline-block w-0.5" />
      </span>
      <Input
        ref={inputRef}
        value={value}
        maxLength={NAME_MAX_LENGTH}
        aria-label={t("roundConfigName")}
        placeholder={placeholder}
        data-testid="round-name-input"
        className="col-start-1 row-start-1 w-0 min-w-full px-2.5 text-sm md:text-sm"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onFinish(true, false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onFinish(false, true);
          } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onFinish(true, true);
          }
        }}
      />
    </span>
  );
}

// 編集に入ったら入力欄へ(文字を全て選択して)、Enter・Escで編集を終えたら表示に戻った後に名前のボタンへ、フォーカスを移す。
function useFocusHandoff(
  editing: boolean,
  inputRef: RefObject<HTMLInputElement | null>,
  buttonRef: RefObject<HTMLButtonElement | null>,
  refocus: RefObject<boolean>,
) {
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (refocus.current) {
      refocus.current = false;
      buttonRef.current?.focus();
    }
  }, [editing, inputRef, buttonRef, refocus]);
}

// ヘッダーのラウンド名。表示のボタンを押すと、その場で入力欄に変わる。Enter(変換中を除く)と入力欄の外の操作で確定し、Escで取り消す。入力は50文字までで、確定でのエラーは持たない。編集を始めたときの名前を起点に、変えた内容がなければ操作を積まない。
export function RoundNameEditor({
  roundId,
  config,
  enqueue,
}: {
  roundId: string;
  config: RoundConfig;
  enqueue: (operation: SyncOperation) => void;
}) {
  const t = useTranslations("rounds");
  const { ids } = useRoundProcedures();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  // 編集を始めたときの名前。編集中は外の値の変化で入力を書き換えない。
  const origin = useRef("");
  // 確定か取り消しの後に届くblurで、二重に確定しない。
  const finished = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Enter・Escで終えたとき、表示に戻った後に名前のボタンへフォーカスを移す。
  const refocus = useRef(false);

  useFocusHandoff(editing, inputRef, buttonRef, refocus);

  function start() {
    origin.current = config.name;
    finished.current = false;
    setValue(config.name);
    setEditing(true);
  }

  function finish(commit: boolean, moveFocus: boolean) {
    if (finished.current) return;
    finished.current = true;
    refocus.current = moveFocus;
    setEditing(false);
    if (!commit) return;
    const operation = buildRoundUpdatedOperation(
      roundId,
      { ...config, name: origin.current },
      { ...config, name: value },
      ids.next(),
    );
    if (operation) enqueue(operation);
  }

  if (editing) {
    return (
      <NameInput
        value={value}
        onChange={setValue}
        onFinish={finish}
        inputRef={inputRef}
      />
    );
  }
  const named = config.name !== "";
  return (
    <button
      ref={buttonRef}
      type="button"
      data-testid="round-name-display"
      aria-label={
        named
          ? t("roundNameEditNamed", { name: config.name })
          : t("roundNameEdit")
      }
      onClick={start}
      className={`block max-w-full truncate rounded-lg text-left ${NAME_BOX} ${named ? "" : "text-muted-foreground"}`}
    >
      {named ? config.name : t("roundNamePlaceholder")}
    </button>
  );
}
