import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  TargetFaceRing,
  TargetFaceSpotLayout,
} from "@/features/rounds/target-face-types";
import {
  lookupTargetFace,
  TargetFaceIcon,
  TargetFaceInfo,
} from "./target-face-icon";

const yellowRing: TargetFaceRing = {
  radius: 8,
  color: "#FFE800",
  line_color: "#000000",
  z_index: 2,
  score_str: "9",
  score_int: 9,
};

const redRing: TargetFaceRing = {
  radius: 16,
  color: "#FF0000",
  line_color: "#000000",
  z_index: 1,
  score_str: "7",
  score_int: 7,
};

describe("TargetFaceIcon", () => {
  const emptySpot: TargetFaceSpotLayout = {
    center_x: 0,
    center_y: 0,
    target_face_rings: [],
  };

  const filledSpot: TargetFaceSpotLayout = {
    center_x: 10,
    center_y: -5,
    target_face_rings: [yellowRing, redRing],
  };

  it("renders a dashed placeholder when no spot has any ring", () => {
    const { container } = render(<TargetFaceIcon spots={[emptySpot]} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("span.border-dashed")).not.toBeNull();
  });

  it("renders a group per spot, positioned by center_x/center_y", () => {
    const { container } = render(
      <TargetFaceIcon spots={[emptySpot, filledSpot]} />,
    );
    // 空のスポットもグループ自体は描画されるが、中身のcircleは持たない。
    const groups = container.querySelectorAll("g");
    expect(groups).toHaveLength(2);
    expect(groups[0].querySelectorAll("circle")).toHaveLength(0);

    const filledGroup = groups[1];
    expect(filledGroup).toHaveAttribute(
      "transform",
      `translate(${filledSpot.center_x} ${-filledSpot.center_y})`,
    );
    expect(filledGroup.querySelectorAll("circle")).toHaveLength(2);
  });
});

describe("lookupTargetFace", () => {
  const faces = [{ id: "a" }, { id: "b" }];

  it('一覧にidが無ければ"missing"を返す(空の一覧を含む)', () => {
    expect(lookupTargetFace(faces, "x")).toBe("missing");
    expect(lookupTargetFace([], "a")).toBe("missing");
  });

  it("一覧にidがあれば、その的を返す", () => {
    expect(lookupTargetFace(faces, "b")).toBe(faces[1]);
  });
});

describe("TargetFaceInfo", () => {
  const face = {
    size: 122,
    target_face_spots: [
      { center_x: 0, center_y: 0, target_face_rings: [yellowRing, redRing] },
    ],
  };

  it("的があれば、サイズと図を表示する", () => {
    const { container } = render(<TargetFaceInfo face={face} />);

    expect(container).toHaveTextContent("122cm");
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("中心の拡大図の得点の文字は、縁取りなしで画面上10.5〜11.0pxになり、十字は実寸のままである", () => {
    // Given
    const ring = (
      radius: number,
      color: string,
      z: number,
    ): TargetFaceRing => ({
      ...yellowRing,
      radius,
      color,
      z_index: z,
    });
    const standardFace = {
      size: 122,
      target_face_spots: [
        {
          center_x: 0,
          center_y: 0,
          target_face_rings: [
            ring(3.05, "#FFE800", 4),
            ring(6.1, "#FFE800", 3),
            ring(12.2, "#FFE800", 2),
            ring(18.3, "#FF0000", 1),
          ],
        },
      ],
    };

    // When
    render(<TargetFaceInfo face={standardFace} />);

    // Then
    const detail = screen.getByRole("img");
    const viewBoxWidth = Number(detail.getAttribute("viewBox")?.split(" ")[2]);
    const score = detail.querySelector("text") as Element;
    const fontPx =
      Number(score.getAttribute("font-size")) * (73 / viewBoxWidth);
    expect(fontPx).toBeGreaterThanOrEqual(10.5);
    expect(fontPx).toBeLessThanOrEqual(11);
    expect(fontPx).toBeGreaterThan(8.61);
    expect(score).not.toHaveAttribute("stroke");
    const [horizontal] = [...detail.querySelectorAll("line")];
    expect(horizontal).toHaveAttribute("x1", "-0.2");
    expect(horizontal).toHaveAttribute("x2", "0.2");
    expect(horizontal).toHaveAttribute("stroke-width", "0.1");
  });

  it("見つからないときは、「的データを取得できません」を表示する", () => {
    const { container } = render(<TargetFaceInfo face="missing" />);

    expect(container).toHaveTextContent("的データを取得できません");
    expect(container.querySelector("svg")).toBeNull();
  });
});
