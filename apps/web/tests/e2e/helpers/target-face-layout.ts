import { expect, type Locator, type Page } from "@playwright/test";
import { forgetTargetFacesOnDevice, TARGET_FACES_REST } from "./reference-data";

// 矩形の比較で許す丸め誤差(px)。
const TOLERANCE = 0.5;

// 的の情報(全体の図・サイズ表記・中心の拡大図)の寸法。表記を持つ的の情報ごとに1件。
type TargetFaceInfoMetrics = {
  iconWidth: number;
  iconLeft: number;
  iconRight: number;
  labelLeft: number;
  labelBottom: number;
  labelFontSize: string;
  detailLeft: number;
  detailTop: number;
  detailWidth: number;
  detailHeight: number;
  infoHeight: number;
  detail: DetailMetrics;
};

// 中心の拡大図の中の寸法(画面上のpx)。
type DetailMetrics = {
  contentWidth: number;
  contentHeight: number;
  scoreFontSizes: number[];
  scoreStrokes: (string | null)[];
  // 環の外側の円の右端から拡大図の内側の右端まで(線の太さを含めない)。
  peek: number;
  // 得点の文字と、その環の内側・外側の境界との間の最小値(中心側の境界は2つ目以降の環だけ)。
  minGapToRingEdge: number;
  // 隣り合う得点の文字の間の最小値。得点が1つのときはInfinity相当の大きな値。
  minGapBetweenScores: number;
  // 得点の文字の上端・下端と、拡大図の内側の上端・下端との間の最小値。
  minGapToVerticalEdge: number;
  // 中心の印(十字)の左の線の先と、拡大図の内側の左端との間。
  crossTipToLeftEdge: number;
};

type LayoutMetrics = {
  scrollWidth: number;
  clientWidth: number;
  // svgの内部を除く子孫のうち、要素の矩形からはみ出しているもののタグ名。
  protrudingTags: string[];
  infos: TargetFaceInfoMetrics[];
};

async function measure(scope: Locator): Promise<LayoutMetrics> {
  return scope.evaluate((root, tolerance) => {
    const measureDetail = (svg: Element) => {
      const rect = svg.getBoundingClientRect();
      const style = getComputedStyle(svg);
      const contentLeft = rect.left + parseFloat(style.borderLeftWidth);
      const contentTop = rect.top + parseFloat(style.borderTopWidth);
      const contentBottom = rect.bottom - parseFloat(style.borderBottomWidth);
      const contentRight = rect.right - parseFloat(style.borderRightWidth);
      // 画面上の実際の描画の倍率と位置(preserveAspectRatioによる余白を含む)。
      const ctm = (svg as SVGSVGElement).getScreenCTM() as DOMMatrix;
      const scale = ctm.a;
      const toX = (x: number) => ctm.e + x * scale;
      const texts = [...svg.querySelectorAll("text")];
      const circles = [...svg.querySelectorAll("circle")];
      const hasNext = circles.length > texts.length;
      // 外側から内側の順。内側から外側へ並べ直す。
      const clusterRadii = circles
        .slice(hasNext ? 1 : 0)
        .map((c) => Number(c.getAttribute("r")))
        .reverse();
      const outer = clusterRadii[clusterRadii.length - 1];
      let minGapToRingEdge = Number.POSITIVE_INFINITY;
      let minGapBetweenScores = Number.POSITIVE_INFINITY;
      let minGapToVerticalEdge = Number.POSITIVE_INFINITY;
      texts.forEach((t, index) => {
        const r = t.getBoundingClientRect();
        minGapToRingEdge = Math.min(
          minGapToRingEdge,
          toX(clusterRadii[index]) - r.right,
        );
        if (index > 0) {
          minGapToRingEdge = Math.min(
            minGapToRingEdge,
            r.left - toX(clusterRadii[index - 1]),
          );
          minGapBetweenScores = Math.min(
            minGapBetweenScores,
            r.left - texts[index - 1].getBoundingClientRect().right,
          );
        }
        minGapToVerticalEdge = Math.min(
          minGapToVerticalEdge,
          r.top - contentTop,
          contentBottom - r.bottom,
        );
      });
      const horizontalLine = [...svg.querySelectorAll("line")].find(
        (l) =>
          Number(l.getAttribute("y1")) === 0 &&
          Number(l.getAttribute("y2")) === 0,
      ) as Element;
      return {
        contentWidth: contentRight - contentLeft,
        contentHeight: contentBottom - contentTop,
        scoreFontSizes: texts.map(
          (t) => Number(t.getAttribute("font-size")) * scale,
        ),
        scoreStrokes: texts.map((t) => t.getAttribute("stroke")),
        peek: contentRight - toX(outer),
        minGapToRingEdge,
        minGapBetweenScores,
        minGapToVerticalEdge,
        crossTipToLeftEdge:
          toX(Number(horizontalLine.getAttribute("x1"))) - contentLeft,
      };
    };
    const rootRect = root.getBoundingClientRect();
    const protrudingTags: string[] = [];
    for (const el of root.querySelectorAll("*")) {
      if (el.closest("svg") !== null && el.tagName.toLowerCase() !== "svg") {
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (
        r.left < rootRect.left - tolerance ||
        r.right > rootRect.right + tolerance
      ) {
        protrudingTags.push(el.tagName.toLowerCase());
      }
    }
    const infos = [...root.querySelectorAll("span")]
      .filter(
        (s) =>
          s.children.length === 0 &&
          /^\d+(\.\d+)?cm$/.test(s.textContent ?? ""),
      )
      .map((label) => {
        const column = label.parentElement as HTMLElement;
        const detail = column.querySelector("svg") as SVGElement;
        const icon = (column.parentElement as HTMLElement).querySelector(
          "svg, span.border-dashed",
        ) as Element;
        const l = label.getBoundingClientRect();
        const d = detail.getBoundingClientRect();
        const i = icon.getBoundingClientRect();
        const infoRect = (
          icon.parentElement as HTMLElement
        ).getBoundingClientRect();
        return {
          infoHeight: infoRect.height,
          detailHeight: d.height,
          detail: measureDetail(detail),
          iconWidth: i.width,
          iconLeft: i.left,
          iconRight: i.right,
          labelLeft: l.left,
          labelBottom: l.bottom,
          labelFontSize: getComputedStyle(label).fontSize,
          detailLeft: d.left,
          detailTop: d.top,
          detailWidth: d.width,
        };
      });
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      protrudingTags,
      infos,
    };
  }, TOLERANCE);
}

// 要素が横にあふれず、子孫(svgの内部を除く)が要素の外にはみ出していないこと。
export async function expectNoHorizontalOverflow(scope: Locator) {
  const m = await measure(scope);
  expect(m.scrollWidth, "scrollWidthがclientWidth以下").toBeLessThanOrEqual(
    m.clientWidth,
  );
  expect(m.protrudingTags, "要素の矩形からはみ出した子孫").toEqual([]);
}

function expectDetailMetrics(info: TargetFaceInfoMetrics) {
  const d = info.detail;
  expect.soft(info.detailWidth, "中心の拡大図の幅").toBeGreaterThanOrEqual(74);
  expect.soft(info.detailWidth, "中心の拡大図の幅").toBeLessThanOrEqual(76);
  expect
    .soft(info.detailHeight, "中心の拡大図の高さ")
    .toBeGreaterThanOrEqual(27);
  expect.soft(info.detailHeight, "中心の拡大図の高さ").toBeLessThanOrEqual(29);
  expect.soft(d.contentWidth, "描画の領域の幅").toBeCloseTo(73, 0);
  expect.soft(d.contentHeight, "描画の領域の高さ").toBeCloseTo(26, 0);
  expect.soft(info.infoHeight, "的の情報の高さ").toBeLessThanOrEqual(48);
  expect.soft(d.scoreFontSizes.length, "得点の文字の数").toBeGreaterThan(0);
  for (const size of d.scoreFontSizes) {
    expect.soft(size, "得点の文字の大きさ").toBeGreaterThanOrEqual(10.5);
    expect.soft(size, "得点の文字の大きさ").toBeLessThanOrEqual(11);
    expect.soft(size, "変更前(8.61px)より大きい").toBeGreaterThan(8.61);
  }
  expect
    .soft(d.scoreStrokes, "得点の文字に縁取りがない")
    .toEqual(d.scoreStrokes.map(() => null));
  expect
    .soft(d.peek, "次の環の覗き(変更前5.02px以上)")
    .toBeGreaterThanOrEqual(5);
  expect
    .soft(d.minGapToRingEdge, "得点の文字と環の境界の間")
    .toBeGreaterThanOrEqual(2);
  expect
    .soft(d.minGapBetweenScores, "得点の文字どうしの間")
    .toBeGreaterThanOrEqual(0);
  expect
    .soft(d.minGapToVerticalEdge, "得点の文字と拡大図の上下の端の間")
    .toBeGreaterThanOrEqual(5);
  // 小さい的では左端に接する、またはわずかに欠けることを認める(-1.0px以上)。
  expect
    .soft(d.crossTipToLeftEdge, "十字の線の先と拡大図の左端の間")
    .toBeGreaterThanOrEqual(-1);
}

// 要素の中の的の情報がすべて、全体の図が左、表記が右上、中心の拡大図が右下の配置であること。
// 戻り値は、要素ごとの全体の図の左端(行をまたいだ位置の比較に使う)。
export async function expectTargetFaceInfoArranged(
  scope: Locator,
  expectedCount: number,
) {
  const m = await measure(scope);
  expect(m.infos, "的の情報の件数").toHaveLength(expectedCount);
  for (const info of m.infos) {
    expect(info.iconWidth, "全体の図の幅").toBeGreaterThanOrEqual(48);
    expectDetailMetrics(info);
    expect(info.labelFontSize, "表記の文字の大きさ").toBe("14px");
    expect(info.iconRight, "全体の図が表記の左").toBeLessThanOrEqual(
      info.labelLeft + TOLERANCE,
    );
    expect(info.labelLeft, "表記と拡大図の左端").toBeCloseTo(
      info.detailLeft,
      0,
    );
    expect(info.labelBottom, "表記が拡大図の上").toBeLessThanOrEqual(
      info.detailTop + TOLERANCE,
    );
  }
  return m.infos.map((i) => i.iconLeft);
}

// ページ全体が横にスクロールしないこと。
export async function expectPageNotScrollingHorizontally(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, "ページのscrollWidth").toBeLessThanOrEqual(innerWidth);
}

// 複数の的の情報の全体の図の左端が、桁数の違うサイズでも一致していること。
export function expectSameLeft(lefts: number[]) {
  for (const left of lefts) {
    expect(left, "全体の図の左端").toBeCloseTo(lefts[0], 0);
  }
}

// 的の一覧の取得を空にして、的データを取得できない表示を再現する。ページを開く前に呼ぶ。
export async function stubMissingTargetFaces(page: Page) {
  await forgetTargetFacesOnDevice(page);
  // Service Workerが制御する文書の通信も置き換えるため、contextで置き換える。
  await page.context().route(TARGET_FACES_REST, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    }),
  );
}

// 行の中で、左側(距離と本数×エンド数)の枠の右端と、的の情報の全体の図の左端との間が12px(±1)であること。
export async function expectGapBeforeTargetFaceInfo(row: Locator) {
  const gap = await row.evaluate((el) => {
    const icon = el.querySelector("svg") as Element;
    const distance = [...el.querySelectorAll("span")].find(
      (s) =>
        s.children.length === 0 &&
        s.closest("svg") === null &&
        /\d+m/.test(s.textContent ?? ""),
    ) as HTMLElement;
    const column = distance.parentElement as HTMLElement;
    return (
      icon.getBoundingClientRect().left - column.getBoundingClientRect().right
    );
  });
  expect(gap, "左側の枠と的の情報の間").toBeGreaterThanOrEqual(11);
  expect(gap, "左側の枠と的の情報の間").toBeLessThanOrEqual(13);
}

// ラウンド詳細の行で、的の情報の右端と展開記号の間が4px以上、展開記号が行の内側の右端に16pxで接すること。
export async function expectExpandMarkerAtRightEdge(row: Locator) {
  const m = await row.evaluate((el) => {
    const icon = el.querySelector("svg") as Element;
    const info = (icon.parentElement as HTMLElement).getBoundingClientRect();
    const svgs = el.querySelectorAll("svg");
    const marker = svgs[svgs.length - 1].getBoundingClientRect();
    const rowRect = el.getBoundingClientRect();
    return {
      gap: marker.left - info.right,
      width: marker.width,
      innerRightGap:
        rowRect.right -
        parseFloat(getComputedStyle(el).paddingRight) -
        marker.right,
    };
  });
  expect(m.gap, "的の情報と展開記号の間").toBeGreaterThanOrEqual(4);
  expect(m.width, "展開記号の幅").toBe(16);
  expect(m.innerRightGap, "展開記号が行の内側の右端").toBeCloseTo(0, 0);
}

// プリセットの取得結果のうち、距離ごとの的を取得できない状態にする(的データを取得できない表示の再現)。ページを開く前に呼ぶ。
export async function stubMissingPresetTargetFaces(page: Page) {
  await page.context().route(/\/rest\/v1\/preset_rounds\?/, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replaceAll(
      /"target_faces":\s*\{[^{}]*(\{[^{}]*(\{[^{}]*\}[^{}]*)*\}[^{}]*)*\}/g,
      '"target_faces":null',
    );
    await route.fulfill({ response, body });
  });
}

// 的選択ダイアログの一覧の項目が、指定の列数の格子で、DOM順に横へ進んで並び、
// 項目の中で的の情報が左右の中央(±1px)にあり、項目の高さが64px(±0.5)であること。
export async function expectOptionGrid(options: Locator, columns: number) {
  const items = await options.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      const icon = el.querySelector("svg") as Element;
      const info = (icon.parentElement as HTMLElement).getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        offCenter: (info.left + info.right) / 2 - (r.left + r.right) / 2,
      };
    }),
  );
  const lefts = [...new Set(items.map((i) => Math.round(i.left)))];
  expect(lefts, "列の数").toHaveLength(columns);
  items.forEach((item, index) => {
    expect(item.height, "項目の高さ").toBeCloseTo(64, 0);
    expect(
      Math.abs(item.offCenter),
      "的の情報の中央からのずれ",
    ).toBeLessThanOrEqual(1);
    if (index === 0) return;
    const prev = items[index - 1];
    const sameRowToRight = item.top === prev.top && item.left > prev.left;
    const nextRowAtLeft =
      item.top > prev.top && Math.round(item.left) === lefts[0];
    expect(
      sameRowToRight || nextRowAtLeft,
      `${index}番目の項目が横へ進む順`,
    ).toBe(true);
  });
  expect(
    new Set(items.map((i) => Math.round(i.width))).size,
    "項目の幅が同じ",
  ).toBe(1);
}
