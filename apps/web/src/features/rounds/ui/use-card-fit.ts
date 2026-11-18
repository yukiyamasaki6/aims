import {
  type CSSProperties,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

// カードの実際の寸法。availableは、枠と左右の余白を除いた、列を並べられる幅。dateは日付の文字の幅(カードによらない基準の文字で測る)、nameMinはラウンド名の最小の幅(全角4文字)、format・bowはタグの文字の幅。
interface CardMetrics {
  available: number;
  date: number;
  nameMin: number;
  format: number;
  bow: number;
}

export interface CardTexts {
  format: string;
  bow: string;
}

export interface CardFonts {
  date: CSSProperties;
  tag: CSSProperties;
}

// 日付の幅は、どのカードも同じ値にするため、日付の値によらず、最も幅の広い数字の基準の文字で測る。
const DATE_REFERENCE = "0000/00/00";
const NAME_REFERENCE = String.fromCodePoint(0x3042, 0x3044, 0x3046, 0x3048);
// 小数の幅の誤差で文字がはみ出さないよう、切り上げて1px足す。
const TEXT_MARGIN_PX = 1;

// 文字の幅を、カードの中に一瞬だけ置いた同じフォントの要素で測る。
function textWidth(host: HTMLElement, font: CSSProperties, text: string) {
  const probe = document.createElement("span");
  probe.style.cssText =
    "position:absolute;visibility:hidden;white-space:nowrap";
  Object.assign(probe.style, font);
  probe.textContent = text;
  host.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  host.removeChild(probe);
  return Math.ceil(width) + TEXT_MARGIN_PX;
}

// レイアウトの無い環境(幅が0)ではnull。
function measureCard(
  element: HTMLElement,
  texts: CardTexts,
  fonts: CardFonts,
): CardMetrics | null {
  if (element.clientWidth === 0) return null;
  const style = getComputedStyle(element);
  const padding =
    Number.parseFloat(style.paddingLeft) +
    Number.parseFloat(style.paddingRight);
  return {
    available: Math.floor(element.clientWidth - padding),
    date: textWidth(element, fonts.date, DATE_REFERENCE),
    nameMin: textWidth(element, fonts.date, NAME_REFERENCE),
    format: textWidth(element, fonts.tag, texts.format),
    bow: textWidth(element, fonts.tag, texts.bow),
  };
}

function sameMetrics(a: CardMetrics | null, b: CardMetrics | null): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.available === b.available &&
      a.date === b.date &&
      a.nameMin === b.nameMin &&
      a.format === b.format &&
      a.bow === b.bow)
  );
}

// カードの幅と文字の幅を測る。測定前(サーバーの描画、測定できない環境)はnull。クライアントでは、描画の前(useLayoutEffect)に測るため、列が出て消えるちらつきは起きない。幅の変化(ResizeObserver)とフォントの読み込み後に測り直す。
export function useCardFit(
  texts: CardTexts,
  fonts: CardFonts,
): { ref: RefObject<HTMLAnchorElement | null>; metrics: CardMetrics | null } {
  const ref = useRef<HTMLAnchorElement>(null);
  const [measured, setMeasured] = useState<CardMetrics | null>(null);
  const { format, bow } = texts;
  // フォントの指定は固定の値で、毎回新しいオブジェクトを渡されても測り直さない(最新の指定は参照から読む)。
  const latest = useRef<CardMetrics | null>(null);
  const fontsRef = useRef(fonts);
  fontsRef.current = fonts;
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const update = () => {
      const next = measureCard(element, { format, bow }, fontsRef.current);
      if (sameMetrics(latest.current, next)) return;
      latest.current = next;
      setMeasured(next);
    };
    update();
    let active = true;
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    document.fonts?.ready.then(() => {
      if (active) update();
    });
    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [format, bow]);
  return { ref, metrics: measured };
}
