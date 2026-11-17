import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { IntroScreen } from "./intro-screen";

const introductionText = translatorFor("introduction");

// 設計の「紹介する項目」の項目。項目が増減したら、ここと設計を一緒に直す。
const ITEM_IDS = ["setup", "preset", "cloud", "offline", "history"] as const;
// 各項目の本文の段落の文言のキー。
const BODY_KEYS = {
  setup: ["setupBody1", "setupBody2"],
  preset: ["presetBody1", "presetBody2"],
  cloud: ["cloudBody1", "cloudBody2"],
  offline: ["offlineBody1", "offlineBody2"],
  history: ["historyBody1", "historyBody2"],
} as const;

// 要件の対象外と未実装の機能から取る語。機能が実装されたら、その語を外す。
const CONDITION_WORDS = ["無料", "料金", "プラン", "アカウント登録", "ゲスト"];
const UNIMPLEMENTED_FEATURE_WORDS = [
  "分析",
  "グラフ",
  "共有",
  "チーム",
  "累計",
  "統計",
];

function foundWords(text: string, words: readonly string[]) {
  return words.filter((word) => text.includes(word));
}

describe("IntroScreen", () => {
  it("紹介画面は、キャッチの見出し1つを表示する", () => {
    // Given

    // When
    render(<IntroScreen />, { wrapper: IntlTestProvider });

    // Then
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: introductionText("catch"),
      }),
    ).toBeInTheDocument();
  });

  it("紹介画面の各項目は、level 2の見出しで区切られ、見出しの下に番号と本文の各段落がある", () => {
    // Given

    // When
    render(<IntroScreen />, { wrapper: IntlTestProvider });

    // Then
    const h1 = screen.getByRole("heading", { level: 1 });
    const h2s = screen.getAllByRole("heading", { level: 2 });
    expect(h2s).toHaveLength(ITEM_IDS.length);
    ITEM_IDS.forEach((id, index) => {
      const h2 = h2s[index];
      expect(h2).toHaveTextContent(introductionText(`${id}Title`));
      const card = within(h2.closest("article") as HTMLElement);
      for (const key of BODY_KEYS[id]) {
        expect(card.getByText(introductionText(key))).toBeInTheDocument();
      }
      expect(
        (h2.closest("article") as HTMLElement).querySelectorAll("p"),
      ).toHaveLength(BODY_KEYS[id].length + 1);
      expect(
        card.getByText(String(index + 1).padStart(2, "0")),
      ).toBeInTheDocument();
      expect(
        h1.compareDocumentPosition(h2) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  it("紹介画面の「記録を始める」は2つあり、1つ目がカードの前、2つ目がカードの後にある", () => {
    // Given

    // When
    render(<IntroScreen />, { wrapper: IntlTestProvider });

    // Then
    const links = screen.getAllByRole("link", {
      name: introductionText("startButton"),
    });
    const [firstCard] = screen.getAllByRole("article");
    const lastCard = screen.getAllByRole("article").at(-1) as HTMLElement;
    expect(links).toHaveLength(2);
    expect(
      links[0].compareDocumentPosition(firstCard) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      links[1].compareDocumentPosition(lastCard) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it("紹介画面のカードの図は、全て装飾として支援技術から隠れる", () => {
    // Given

    // When
    render(<IntroScreen />, { wrapper: IntlTestProvider });

    // Then
    // ヘッダーのロゴはimgのroleを持つため、本文(main)に絞る。
    const main = screen.getByRole("main");
    expect(within(main).queryByRole("img")).not.toBeInTheDocument();
    const svgs = main.querySelectorAll("svg");
    expect(svgs).toHaveLength(ITEM_IDS.length);
    for (const svg of svgs) {
      expect(svg.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it("紹介画面の本文は、利用の条件に触れない", () => {
    // Given

    // When
    render(<IntroScreen />, { wrapper: IntlTestProvider });

    // Then
    const text = screen.getByRole("main").textContent ?? "";
    expect(foundWords(text, CONDITION_WORDS)).toEqual([]);
  });

  it("紹介画面の本文は、今ない機能の語を載せない", () => {
    // Given

    // When
    render(<IntroScreen />, { wrapper: IntlTestProvider });

    // Then
    const text = screen.getByRole("main").textContent ?? "";
    expect(foundWords(text, UNIMPLEMENTED_FEATURE_WORDS)).toEqual([]);
  });
});
